require('chai').use(require('bn-chai')(web3.utils.BN)).use(require('chai-as-promised')).should()
require('dotenv').config({ path: __dirname + '/../.env' })
const circomlib = require('circomlib')
const snarkjsOriginal = require('snarkjs-original')
const snarkjsTornado = require('snarkjs-tornado')
const bigInt = snarkjsTornado.bigInt
const MerkleTree = require('fixed-merkle-tree')
const crypto = require('crypto')
const { toBN, randomHex } = require('web3-utils')
const { ETH_AMOUNT, MERKLE_TREE_HEIGHT } = process.env
const OriginWrappedETH = artifacts.require('OriginWrappedETH')

/** 
 * Taken from https://github.com/tornadocash/tornado-core/blob/master/src/cli.js
 * BigNumber to hex string of specified length 
*/
function toHex(number, length = 32) {
    const str = number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)
    return '0x' + str.padStart(length * 2, '0')
}

/** 
 * Taken from https://github.com/tornadocash/tornado-core/blob/master/src/cli.js
 * Generate random number of specified byte length 
*/
const rbigint = nbytes => snarkjsTornado.bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** 
 * Taken from https://github.com/tornadocash/tornado-core/blob/master/src/cli.js
 * Compute pedersen hash 
*/
const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/**
 * Taken from https://github.com/tornadocash/tornado-core/blob/master/test/ETHTornado.test.js
*/
function generateDeposit() {
    let deposit = {
      secret: rbigint(31),
      nullifier: rbigint(31),
    }
    const preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
    deposit.commitment = pedersenHash(preimage) // bitInt type
    return deposit
}


contract('OriginWrappedETH', (accounts) => {

    let tree
    let originContract
    let sender

    before(async () => {
        tree = new MerkleTree(MERKLE_TREE_HEIGHT)
        originContract = await OriginWrappedETH.deployed()
        sender = accounts[0]
    })

    describe('#constructor', () => {
        it('should initialize', async () => {
          const etherDenomination = await originContract.denomination()
          etherDenomination.should.be.eq.BN(toBN(ETH_AMOUNT))
        })
    })

    describe('#deposit', () => {

        // it('first deposit; should emit Deposit event with correctly calculated root and leaf index', async () => {
        //   let commitment = toHex(generateDeposit().commitment)
        //   let { logs } = await originContract.deposit(commitment, { value: ETH_AMOUNT, from: sender })
        //   tree.insert(commitment)

        //   logs[0].event.should.be.equal('Deposit')
        //   logs[0].args.commitment.should.be.equal(commitment)
        //   logs[0].args.leafIndex.should.be.eq.BN(0)
        //   logs[0].args.root.should.be.equal(toHex(tree.root()))
        // })

        let secondCommitment = toHex(generateDeposit().commitment)

        // it('second deposit; should emit Deposit event with correctly calculated root and leaf index', async () => {
        //     let { logs } = await originContract.deposit(secondCommitment, { value: ETH_AMOUNT, from: sender })
        //     tree.insert(secondCommitment)
  
        //     logs[0].event.should.be.equal('Deposit')
        //     logs[0].args.commitment.should.be.equal(secondCommitment)
        //     logs[0].args.leafIndex.should.be.eq.BN(1)
        //     logs[0].args.root.should.be.equal(toHex(tree.root())) 
        // })

        // it('should throw in order to prevent submitting identical commitments', async () => {
        //     const error = await originContract.deposit(secondCommitment, { value: ETH_AMOUNT, from: sender }).should.be.rejected
        //     // error.reason.should.be.equal('The commitment has been submitted')
        // })

        it('should throw in order to prevent submitting commitment with inapropproate denomination', async () => {
            const error = await originContract.deposit(toHex(generateDeposit().commitment), { value: '123', from: sender }).should.be.rejected
            // error.reason.should.be.equal('The commitment has been submitted')
        })
    })
})