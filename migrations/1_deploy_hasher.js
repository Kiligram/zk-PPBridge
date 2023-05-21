/* global artifacts */
const Hasher = artifacts.require('Hasher')

module.exports = function (deployer) {
  return deployer.then(async () => {
    await deployer.deploy(Hasher)
  })
}
