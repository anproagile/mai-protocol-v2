const assert = require('assert');
const {
    initializeToken,
    call,
    send,
    increaseEvmBlock,
    toBytes32
} = require('./funcs');
const {
    toWad,
    fromWad,
    infinity,
    Side
} = require('./constants');
const {
    buildOrder,
    getOrderHash
} = require('./order');

const Exchange = artifacts.require("exchange/Exchange.sol");
const TestToken = artifacts.require('test/TestToken.sol');
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Perpetual = artifacts.require('test/TestPerpetual.sol');
const AMM = artifacts.require('test/TestAMM.sol');
const Proxy = artifacts.require('proxy/PerpetualProxy.sol');
const ShareToken = artifacts.require('token/ShareToken.sol');

contract('exchange-amm', accounts => {
    const FLAT = 0;
    const SHORT = 1;
    const LONG = 2;

    let collateral;
    let global;
    let funding;
    let perpetual;
    let exchange;
    let share;

    const broker = accounts[9];
    const admin = accounts[0];
    const dev = accounts[1];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];
    const u4 = accounts[7];

    const users = {
        broker,
        admin,
        u1,
        u2,
        u3,
        u4,
    };

    const increaseBlockBy = async (n) => {
        for (let i = 0; i < n; i++) {
            await increaseEvmBlock();
        }
    };

    const deploy = async () => {
        exchange = await Exchange.new();
        priceFeeder = await PriceFeeder.new();
        share = await ShareToken.new("ST", "STK", 18);
        collateral = await TestToken.new("TT", "TestToken", 18);
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
        await perpetual.addWhitelisted(exchange.address);
    };

    const useDefaultGlobalConfig = async () => {
        await globalConfig.setGlobalParameter(toBytes32("withdrawalLockBlockCount"), 5);
        await globalConfig.setGlobalParameter(toBytes32("brokerLockBlockCount"), 5);
    };

    const useDefaulGovParamters = async () => {
        await perpetual.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(0.1));
        await perpetual.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.05));
        await perpetual.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("makerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("lotSize"), 1);
        await perpetual.setGovernanceParameter(toBytes32("tradingLotSize"), 1);
    };

    const usePoolDefaultParamters = async () => {
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
        await increaseBlockBy(5);
    };

    const copy = (obj) => {
        return JSON.parse(JSON.stringify(obj));
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
    const positionEntrySocialLoss = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.entrySocialLoss;
    }
    const positionEntryFundingLoss = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.entryFundingLoss;
    }
    const cashBalanceOf = async (user) => {
        const cashAccount = await perpetual.getCashBalance(user);
        return cashAccount.balance;
    }
    const appliedBalanceOf = async (user) => {
        const cashAccount = await perpetual.getCashBalance(user);
        return cashAccount.appliedBalance;
    }
    const isPositionBalanced = async () => {
        const long = (await perpetual.totalSize(LONG)).toString();
        const short = (await perpetual.totalSize(SHORT)).toString();
        const flat = (await perpetual.totalSize(FLAT)).toString();
        return (long == short) && (flat == "0")
    }


    beforeEach(async () => {
        await deploy();
        await useDefaultGlobalConfig();
        await useDefaulGovParamters();
        await usePoolDefaultParamters();
    });

    describe("trades", async () => {

        beforeEach(async () => {
            // index
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u1, toWad(7000 * 21));
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.transfer(dev, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, {
                from: u1
            });
            await collateral.approve(perpetual.address, infinity, {
                from: u2
            });
            await collateral.approve(perpetual.address, infinity, {
                from: dev
            });

            // create amm
            await perpetual.deposit(toWad(7000 * 10 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(10), {
                from: u1
            });

            await setBroker(u1, admin);
            await setBroker(u2, admin);
            await amm.addWhitelisted(exchange.address);
        });

        it("buy", async () => {
            await perpetual.deposit(toWad(7000 * 1), {
                from: u2
            });

            const takerOrder = await buildOrder({
                trader: u2,
                amount: 1,
                price: 10000,
                version: 2,
                side: 'buy',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 0,
                takerFeeRate: 0,
                salt: 666,
            }, perpetual.address, admin);

            await exchange.matchOrderWithAMM(
                takerOrder,
                perpetual.address,
                toWad(1)
            );

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
        });

        it("buy - success - pnl < 0, critical deposit amount", async () => {
            await perpetual.deposit(toWad('87.67676767676767677'), {
                from: u2
            });
            const takerOrder = await buildOrder({
                trader: u2,
                amount: 0.1,
                price: 10000,
                version: 2,
                side: 'buy',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 0,
                takerFeeRate: 0,
                salt: 666,
            }, perpetual.address, admin);

            await exchange.matchOrderWithAMM(
                takerOrder,
                perpetual.address,
                toWad(0.1)
            );
        });

        it("buy - fail - pnl < 0, lower than critical deposit amount", async () => {
            await perpetual.deposit(toWad('87.67676767676767676'), {
                from: u2
            });
            const takerOrder = await buildOrder({
                trader: u2,
                amount: 0.1,
                price: 10000,
                version: 2,
                side: 'buy',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 0,
                takerFeeRate: 0,
                salt: 666,
            }, perpetual.address, admin);
            try {
                await exchange.matchOrderWithAMM(
                    takerOrder,
                    perpetual.address,
                    toWad(0.1)
                );
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("im unsafe"), error);
            }
        });

        it("sell - success", async () => {
            await perpetual.deposit(toWad(2000), {
                from: u2
            });

            const takerOrder = await buildOrder({
                trader: u2,
                amount: 1,
                price: 0,
                version: 2,
                side: 'sell',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 0,
                takerFeeRate: 0,
                salt: 666,
            }, perpetual.address, admin);

            await exchange.matchOrderWithAMM(
                takerOrder,
                perpetual.address,
                toWad(1)
            );

            assert.equal(fromWad(await amm.positionSize()), 11);
            assert.equal(fromWad(await positionSize(proxy.address)), 11);
            assert.equal(fromWad(await positionSize(u1)), 10);
            assert.equal(fromWad(await positionSize(u2)), 1);
            assert.equal(await positionSide(proxy.address), Side.LONG);
            assert.equal(await positionSide(u1), Side.SHORT);
            assert.equal(await positionSide(u2), Side.SHORT);

            assert.equal(fromWad(await cashBalanceOf(u2)), '1904.545454545454545454');
            assert.equal(fromWad(await share.balanceOf(u2)), 0);
            assert.equal(fromWad(await positionEntryValue(u2)), '6363.636363636363636364'); // trade price * position
            assert.equal(fromWad(await perpetual.pnl.call(u2)), '-636.363636363636363637');

            assert.equal(fromWad(await amm.currentAvailableMargin.call()), 63700); // amm.x
            assert.equal(fromWad(await cashBalanceOf(proxy.address)), '140063.636363636363636364');
            assert.equal(fromWad(await positionEntryValue(proxy.address)), '76363.636363636363636364');
            assert.equal(fromWad(await amm.currentFairPrice.call()), '5790.909090909090909091');
        });

        it("buy and sell - success", async () => {
            await perpetual.deposit(toWad(7000), {
                from: u2
            });
            let takerOrder = await buildOrder({
                trader: u2,
                amount: 1,
                price: 8100,
                version: 2,
                side: 'buy',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 0,
                takerFeeRate: 0,
                salt: 666,
            }, perpetual.address, admin);

            await exchange.matchOrderWithAMM(
                takerOrder,
                perpetual.address,
                toWad(1)
            );

            assert.equal(fromWad(await amm.positionSize()), 9);
            assert.equal(fromWad(await positionSize(proxy.address)), 9);
            assert.equal(fromWad(await positionSize(u2)), 1);
            assert.equal(await positionSide(proxy.address), Side.LONG);
            assert.equal(await positionSide(u2), Side.LONG);
            assert.equal(fromWad(await cashBalanceOf(u2)), '6883.333333333333333333');
            assert.equal(fromWad(await positionEntryValue(u2)), '7777.777777777777777778');
            assert.equal(fromWad(await perpetual.pnl.call(u2)), '-777.777777777777777779');

            assert.equal(fromWad(await amm.currentAvailableMargin.call()), '77855.555555555555555555'); // amm.x
            assert.equal(fromWad(await cashBalanceOf(proxy.address)), '140855.555555555555555555');
            assert.equal(fromWad(await positionEntryValue(proxy.address)), '63000');
            assert.equal(fromWad(await amm.currentFairPrice.call()), '8650.617283950617283951');

            takerOrder = await buildOrder({
                trader: u2,
                amount: 2,
                price: 0,
                version: 2,
                side: 'sell',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 0,
                takerFeeRate: 0,
                salt: 666,
            }, perpetual.address, admin);

            await exchange.matchOrderWithAMM(
                takerOrder,
                perpetual.address,
                toWad(2)
            );

            assert.equal(fromWad(await amm.positionSize()), 11);
            assert.equal(fromWad(await positionSize(proxy.address)), 11);
            assert.equal(fromWad(await positionSize(u1)), 10);
            assert.equal(fromWad(await positionSize(u2)), 1);
            assert.equal(await positionSide(proxy.address), Side.LONG);
            assert.equal(await positionSide(u1), Side.SHORT);
            assert.equal(await positionSide(u2), Side.SHORT);
            assert.equal(fromWad(await cashBalanceOf(u2)), '5970.999999999999999998');
            assert.equal(fromWad(await positionEntryValue(u2)), '7077.777777777777777778');
            assert.equal(fromWad(await perpetual.pnl.call(u2)), '77.777777777777777777');

            assert.equal(fromWad(await amm.currentAvailableMargin.call()), '63841.555555555555555555'); // amm.x
            assert.equal(fromWad(await cashBalanceOf(proxy.address)), '140997.111111111111111111');
            assert.equal(fromWad(await positionEntryValue(proxy.address)), '77155.555555555555555556');
            assert.equal(fromWad(await amm.currentFairPrice.call()), '5803.777777777777777778');
        });
    });
});