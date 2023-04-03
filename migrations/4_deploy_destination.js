/* global artifacts */
require('dotenv').config({ path: '../.env' })
const DestinationWrappedETH = artifacts.require('DestinationWrappedETH')
const Verifier = artifacts.require('Verifier')

module.exports = function (deployer) {
  return deployer.then(async () => {
    const verifier = await Verifier.deployed()
    const { ETH_AMOUNT, BRIDGE_ADDRESS } = process.env
    const originWETH = await deployer.deploy(
      DestinationWrappedETH,
      BRIDGE_ADDRESS, 
      verifier.address,
      ETH_AMOUNT
    )
    // console.log("Destination smart contract address: ", originWETH.address)
  })
}
