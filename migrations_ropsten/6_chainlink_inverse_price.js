const ChainlinkAdapter = artifacts.require('oracle/ChainlinkAdapter.sol');
const { fromWad } = require('../test/constants');

module.exports = async function (deployer, network, accounts) {
    // mainnet
    //   eth/usd 0xF79D6aFBb6dA890132F9D7c355e3015f15F3406F https://feeds.chain.link/eth-usd
    // 
    // ropsten https://docs.chain.link/docs/using-chainlink-reference-contracts#section-test-reference-data-contracts-ropsten
    //   eth/usd 0x8468b2bDCE073A157E560AA4D9CcF6dB1DB98507

    await deployer.deploy(ChainlinkAdapter, '0x8468b2bDCE073A157E560AA4D9CcF6dB1DB98507', 3600 * 6, { gas: 650000 });
    const priceFeeder = await ChainlinkAdapter.deployed();

    console.log('  「 Address summary 」--------------------------------------');
    console.log('   > priceFeeder:    ', priceFeeder.address);
    
    const p = await priceFeeder.price()
    console.log('    (priceFeeder simple test:', fromWad(p.newPrice), p.timestamp.toString(), ')')
};
