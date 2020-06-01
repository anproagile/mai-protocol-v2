const Perpetual = artifacts.require('perpetual/Perpetual.sol');
const Proxy = artifacts.require('proxy/PerpetualProxy.sol');

module.exports = async function (deployer, network, accounts) {
    const perpetual = await Perpetual.deployed();

    await deployer.deploy(Proxy, perpetual.address);
};
