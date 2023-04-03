/* global artifacts */
const Hasher = artifacts.require('Hasher')

module.exports = function (deployer) {
  return deployer.then(async () => {
    const hasher = await deployer.deploy(Hasher)
    // console.log("Hasher address: ", hasher.address)
  })
}
