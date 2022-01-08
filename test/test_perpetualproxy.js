const assert = require('assert');
const BigNumber = require('bignumber.js');
const {
    increaseEvmBlock,
    increaseEvmTime,
    createEVMSnapshot,
    restoreEVMSnapshot,
    toBytes32,
    assertApproximate
} = require('./funcs');
const {
    toWei,
    fromWei,
    toWad,
    fromWad,
    infinity,
    Side
} = require('./constants');

const TestToken = artifacts.require('test/TestToken.sol');
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Perpetual = artifacts.require('test/TestPerpetual.sol');
const AMM = artifacts.require('test/TestAMM.sol');
const Proxy = artifacts.require('proxy/PerpetualProxy.sol');
const ShareToken = artifacts.require('token/ShareToken.sol');

const gasLimit = 8000000;

contract('amm', accounts => {
    let priceFeeder;
    let collateral;
    let globalConfig;
    let perpetual;
    let proxy;
    let amm;
    let share;

    const broker = accounts[9];
    const admin = accounts[0];
    const dev = accounts[1];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    const users = {
        broker,
        admin,
        dev,
        u1,
        u2,
        u3,
    };

    let snapshotId;

    const increaseBlockBy = async (n) => {
        for (let i = 0; i < n; i++) {
            await increaseEvmBlock();
        }
    };

    const deploy = async () => {
        priceFeeder = await PriceFeeder.new();
        collateral = await TestToken.new("TT", "TestToken", 18);
        share = await ShareToken.new("ST", "STK", 18);
        globalConfig = await GlobalConfig.new();
        perpetual = await Perpetual.new(
            globalConfig.address,
            dev,
            collateral.address,
            18
        );
        proxy = await Proxy.new(perpetual.address);
        amm = await AMM.new(proxy.address, priceFeeder.address, share.address);
        await share.addMinter(amm.address);
        await share.renounceMinter();

        await perpetual.setGovernanceAddress(toBytes32("amm"), amm.address);
        await perpetual.addWhitelisted(proxy.address);
    };

    const useDefaultGlobalConfig = async () => {
        await globalConfig.setGlobalParameter(toBytes32("withdrawalLockBlockCount"), 5);
        await globalConfig.setGlobalParameter(toBytes32("brokerLockBlockCount"), 5);
    };

    const useDefaultGovParameters = async () => {
        await perpetual.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(0.1));
        await perpetual.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.05));
        await perpetual.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("makerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("lotSize"), 1);
        await perpetual.setGovernanceParameter(toBytes32("tradingLotSize"), 1);
    };

    const usePoolDefaultParameters = async () => {
        await amm.setGovernanceParameter(toBytes32("poolFeeRate"), toWad(0.01));
        await amm.setGovernanceParameter(toBytes32("poolDevFeeRate"), toWad(0.005));
        await amm.setGovernanceParameter(toBytes32("updatePremiumPrize"), toWad(1));
        await amm.setGovernanceParameter(toBytes32('emaAlpha'), '3327787021630616'); // 2 / (600 + 1)
        await amm.setGovernanceParameter(toBytes32('markPremiumLimit'), toWad(0.005));
        await amm.setGovernanceParameter(toBytes32('fundingDampener'), toWad(0.0005));
    };

    const setIndexPrice = async price => {
        await priceFeeder.setPrice(toWad(price));

        // priceFeeder will modify index.timestamp, amm.timestamp should >= index.timestamp
        const index = await amm.indexPrice();
        await amm.setBlockTimestamp(index.timestamp);
    };

    const setBroker = async (user, broker) => {
        await perpetual.setBroker(broker, {
            from: user
        });
        for (let i = 0; i < 4; i++) {
            await increaseEvmBlock();
        }
    };

    const positionSize = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.size;
    }

    const positionSide = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.side;
    }

    const positionEntryValue = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.entryValue;
    }

    const positionEntryFundingLoss = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.entryFundingLoss;
    }
    const cashBalanceOf = async (user) => {
        const cashAccount = await perpetual.getCashBalance(user);
        return cashAccount.balance;
    }

    beforeEach(async () => {
        await deploy();
        await useDefaultGlobalConfig();
        await useDefaultGovParameters();
        await usePoolDefaultParameters();
        await setBroker(u1, proxy.address);

        await setIndexPrice(7000);
        const indexPrice = await amm.indexPrice();
        assert.equal(fromWad(indexPrice.price), 7000);

        // approve
        await collateral.transfer(u1, toWad(7000 * 10 * 2.1));
        await collateral.transfer(u2, toWad(7000 * 3));
        await collateral.transfer(u3, toWad(7000 * 3));
        await collateral.transfer(dev, toWad(7000 * 3));
        await collateral.approve(perpetual.address, infinity, {
            from: u1
        });
        await collateral.approve(perpetual.address, infinity, {
            from: u2
        });
        await collateral.approve(perpetual.address, infinity, {
            from: u3
        });
        await collateral.approve(perpetual.address, infinity, {
            from: dev
        });
        await setBroker(u2, proxy.address);
        await setBroker(u3, proxy.address);
        await increaseBlockBy(4);

        // create amm
        await perpetual.deposit(toWad(7000 * 10 * 2.1), {
            from: u1
        });
        await amm.createPool(toWad(10), {
            from: u1
        });
    });

    it("buy - success", async () => {
        // buy 1, entryPrice will be 70000 / (10 - 1) = 7777 but markPrice is still 7000
        // pnl = -777, positionMargin = 700

        await perpetual.deposit(toWad(7000 * 1), {
            from: u2
        });
        await amm.buy(toWad(1), toWad('10000'), infinity, {
            from: u2
        });

        // await inspect(u1);
        // await inspect(u2);
        // await inspect(proxy.address);
        // await printFunding();

        assert.equal(fromWad(await amm.positionSize()), 9);
        assert.equal(fromWad(await positionSize(proxy.address)), 9);
        assert.equal(fromWad(await positionSize(u1)), 10);
        assert.equal(fromWad(await positionSize(u2)), 1);
        assert.equal(await positionSide(proxy.address), Side.LONG);
        assert.equal(await positionSide(u1), Side.SHORT);
        assert.equal(await positionSide(u2), Side.LONG);

        assert.equal(fromWad(await cashBalanceOf(u2)), '6883.333333333333333333');
        assert.equal(fromWad(await share.balanceOf(u2)), 0);
        assert.equal(fromWad(await positionEntryValue(u2)), '7777.777777777777777778'); // trade price * position
        assert.equal(fromWad(await perpetual.pnl.call(u2)), '-777.777777777777777779');

        assert.equal(fromWad(await amm.currentAvailableMargin.call()), '77855.555555555555555555'); // amm.x
        assert.equal(fromWad(await cashBalanceOf(proxy.address)), '140855.555555555555555555');
        assert.equal(fromWad(await positionEntryValue(proxy.address)), '63000');
        assert.equal(fromWad(await amm.currentFairPrice.call()), '8650.617283950617283951');

        assert.equal(await proxy.settlementPrice(), 0);
        assert.equal(fromWad(await proxy.availableMargin.call(proxy.address)), fromWad(await perpetual.availableMargin.call(proxy.address)));
        assert.equal(fromWad(await proxy.cashBalance()), '140855.555555555555555555');
        assert.equal(await proxy.positionSide(), Side.LONG);
        assert.equal(fromWad(await proxy.positionEntryValue()), '63000');
        assert.equal(fromWad(await proxy.positionEntrySocialLoss()), '0');
        assert.equal(fromWad(await proxy.positionEntryFundingLoss()), '0');
        assert.equal(fromWad(await proxy.socialLossPerContract(Side.LONG)), '0');
        assert.equal(fromWad(await proxy.socialLossPerContract(Side.SHORT)), '0');
        assert.equal(await proxy.isProxySafe.call(), true);
        assert.equal(await proxy.isIMSafe.call(proxy.address), true);
    });


     it("privileges", async () => {
         try {
            await proxy.transferBalanceIn("0x1111111111111111111111111111111111111111", toWad(1));
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.transferBalanceIn("0x1111111111111111111111111111111111111111", toWad(1));
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.transferBalanceOut("0x1111111111111111111111111111111111111111", toWad(1));
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.transferBalanceTo("0x1111111111111111111111111111111111111111", "0x1111111111111111111111111111111111111111", toWad(1));
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.trade("0x1111111111111111111111111111111111111111", 1, toWad(6000), toWad(1));
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.setBrokerFor("0x1111111111111111111111111111111111111111", "0x1111111111111111111111111111111111111112");
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.depositFor("0x1111111111111111111111111111111111111111", toWad(1));
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.depositEtherFor("0x1111111111111111111111111111111111111111", { value: toWad(1)});
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }

        try {
            await proxy.withdrawFor("0x1111111111111111111111111111111111111111", toWad(1));
            throw null;
         } catch (error) {
             assert.ok(error.message.includes("invalid caller"));
         }
     });
});