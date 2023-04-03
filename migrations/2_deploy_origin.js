/* global artifacts */
require('dotenv').config({ path: '../.env' })
const OriginWrappedETH = artifacts.require('OriginWrappedETH')
const Hasher = artifacts.require('Hasher')

module.exports = function (deployer) {
  return deployer.then(async () => {
    const hasher = await Hasher.deployed()
    const { MERKLE_TREE_HEIGHT, ETH_AMOUNT, BRIDGE_ADDRESS } = process.env

    const originWETH = await deployer.deploy(
      OriginWrappedETH,
      BRIDGE_ADDRESS, 
      hasher.address,
      ETH_AMOUNT,
      MERKLE_TREE_HEIGHT,
    )
    // console.log("Origin smart contract address: ", originWETH.address)
  })
}
