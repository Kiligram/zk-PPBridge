require('dotenv').config({ path: __dirname + '/../.env' })
const snarkjsTornado = require('snarkjs-tornado')
const snarkjsOriginal = require('snarkjs-original')
const bigInt = snarkjsTornado.bigInt
const fs = require("fs");
const assert = require('assert')
const crypto = require('crypto')
const merkleTree = require('fixed-merkle-tree')
const circomlib = require('circomlib')
const { program } = require('commander');

const websnarkUtils = require('websnark/src/utils');
const Web3 = require('web3')
const { toWei } = require('web3-utils')

const PATH_CIRCUIT_WASM = __dirname + '/../circuits/build/withdraw_js/withdraw.wasm'
const PATH_CIRCUIT_ZKEY = __dirname + '/../circuits/build/withdraw_final.zkey'
const PATH_ORIGIN_CONTRACT = __dirname + '/../build/contracts/OriginWrappedETH.json'
const PATH_DESTINATION_CONTRACT = __dirname + '/../build/contracts/DestinationWrappedETH.json'
const PATH_VERIFICATION_KEY = __dirname + '/../circuits/build/verification_key.json'

let MERKLE_TREE_HEIGHT, ETH_AMOUNT
let ORIGIN_NETWORK_ID, DESTINATION_NETWORK_ID

let web3_origin, web3_destination, origin_contract, destination_contract, current_account

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
 * Taken from https://github.com/tornadocash/tornado-core/blob/master/src/cli.js
 * BigNumber to hex string of specified length 
*/
function toHex(number, length = 32) {
    const str = number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)
    return '0x' + str.padStart(length * 2, '0')
}

/** Display wallet balance on origin network*/
async function printOriginBalance(address) {
  console.log(`Balance of address ${address} in origin network is:`, web3_origin.utils.fromWei(await web3_origin.eth.getBalance(address)))
}

/** Display wallet balance on destination network*/
async function printDestinationBalance(address) {
  console.log(`Balance of address ${address} in destination network is:`, web3_destination.utils.fromWei(await web3_destination.eth.getBalance(address)))
}

/** Display ERC20 account balance on destionation network*/
async function printDestinationERC20Balance(address) {
  console.log(`Token Balance of address ${address} is:`, web3_destination.utils.fromWei(await destination_contract.methods.balanceOf(address).call()))
}

/**
 * Taken from https://github.com/tornadocash/tornado-core/blob/master/src/cli.js
 * Create deposit object from secret and nullifier
 */
function createDeposit({ nullifier, secret }) {
  const deposit = { nullifier, secret }
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(deposit.preimage)
  deposit.nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31))
  // console.log(deposit.nullifier.leInt2Buff(31))
  // console.log(deposit)
  return deposit
}

async function deposit() {
    const deposit = createDeposit({ nullifier: rbigint(31), secret: rbigint(31) })

    await origin_contract.methods.deposit(toHex(deposit.commitment)).send({ value: ETH_AMOUNT, from: current_account, gas: 2e6 })
      .on('transactionHash', function (txHash) {
        console.log(`The transaction hash is ${txHash}`)
      }).on('error', function (e) {
        console.error('on transactionHash error', e.message)
      })

    console.log(`Your secret: ${deposit.secret}`)
    console.log(`Your nullifier: ${deposit.nullifier}`)

    return deposit
}

async function withdrawToOrigin(address, amountETH){
  const amountWei = toWei(amountETH)

  // const functionToEstimate = destination_contract.methods.withdrawToOrigin(address, amountWei)

  // functionToEstimate.estimateGas({ from: current_account })
  //   .then((gasAmount) => {
  //       console.log(`Estimated gas for myFunction: ${gasAmount}`);
  //   })
  //   .catch((error) => {
  //       console.error(error);
  //   });

  await destination_contract.methods.reclaim(address, amountWei).send({from: current_account, gas: 1e5})
    .on('transactionHash', function (txHash) {
      console.log(`The transaction hash is ${txHash}`)
    }).on('error', function (e) {
      console.error('on transactionHash error', e.message)
    })
}

async function withdrawToDestination({nullifier, secret, recipient}){
  const deposit = createDeposit({ nullifier: bigInt(nullifier), secret: bigInt(secret) })

  const { solProof, args } = await generateProof({ deposit, recipient })
  console.log('Submitting withdraw transaction')
  await destination_contract.methods.withdraw(solProof, ...args).send({ from: current_account, gas: 1e5 * 4 })
    .on('transactionHash', function (txHash) {
      console.log(`The transaction hash is ${txHash}`)
    }).on('error', function (e) {
      console.error('on transactionHash error', e.message)
    })
}

/**
 * Taken from https://github.com/tornadocash/tornado-core/blob/master/src/cli.js
 * Generate merkle tree for a deposit.
 * Download deposit events from the tornado, reconstructs merkle tree, finds our deposit leaf
 * in it and generates merkle proof
 * @param deposit Deposit object
 */
async function generateMerkleProof(deposit) {
  // Get all deposit events from smart contract and assemble merkle tree from them
  console.log('Getting current state from contract')
  const events = await origin_contract.getPastEvents('Deposit', { fromBlock: 0, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map(e => e.returnValues.commitment)
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves)

  // Find current commitment in the tree
  const depositEvent = events.find(e => e.returnValues.commitment === toHex(deposit.commitment))
  const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1

  // Validate that our data is correct
  const root = tree.root()
  console.log('Root: ' + toHex(root))
  const isValidRoot = await destination_contract.methods.isKnownRoot(toHex(root)).call()
  const isSpent = await destination_contract.methods.isSpent(toHex(deposit.nullifierHash)).call()
  assert(isValidRoot === true, 'Merkle tree is corrupted')
  assert(isSpent === false, 'The note is already spent')
  assert(leafIndex >= 0, 'The deposit is not found in the tree')

  // Compute merkle proof of our commitment
  const { pathElements, pathIndices } = tree.path(leafIndex)
  // console.log(pathElements)
  // console.log(deposit.commitment)
  // console.log(toHex(deposit.commitment))
  return { pathElements, pathIndices, root: tree.root() }
}

/**
 * Inspired by https://github.com/tornadocash/tornado-core/blob/master/src/cli.js
 * Generate SNARK proof for withdrawal
 * @param deposit Deposit object
 * @param recipient Funds recipient
 * @param relayer Relayer address
 * @param fee Relayer fee
 * @param refund Receive ether for exchanged tokens
 */
async function generateProof({ deposit, recipient, relayerAddress = 0, fee = 0, refund = 0 }) {
  // Compute merkle proof of our commitment
  const { root, pathElements, pathIndices } = await generateMerkleProof(deposit)

  // Prepare circuit input
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    recipient: bigInt(recipient),
    relayer: bigInt(relayerAddress),
    fee: bigInt(fee),
    refund: bigInt(refund),

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: pathElements,
    pathIndices: pathIndices,
  }

  // console.log(input)

  // console.log('Generating SNARK proof')
  // console.time('Proof time')
  // const { proof, publicSignals } = await snarkjsOriginal.groth16.fullProve(input, PATH_CIRCUIT_WASM, PATH_CIRCUIT_ZKEY);
  // const solProof = websnarkUtils.toSolidityInput(proof).proof
  // console.timeEnd('Proof time')
  
  // const vKey = JSON.parse(fs.readFileSync(PATH_VERIFICATION_KEY));
  // var res = false
  // do{
  //   var pi_a = ''
  //   for(var i = 0; i < 77; i++){
  //     pi_a += String.fromCharCode(48 + Math.floor(Math.random() * 9))[0]
  //   }
  //   proof.pi_a[0] = pi_a
  //   console.log(proof.pi_a[0])
  //   res = await snarkjsOriginal.groth16.verify(vKey, publicSignals, proof);
  //   if (res === true) {
  //       console.log("Verification OK");
  //   } else {
  //       console.log("Invalid proof");
  //   }
  // } while(res === false)

  
  const vKey = JSON.parse(fs.readFileSync(PATH_VERIFICATION_KEY));
  console.log('Generating SNARK proof')
  do {
    console.time('Proof time')
    var { proof, publicSignals } = await snarkjsOriginal.groth16.fullProve(input, PATH_CIRCUIT_WASM, PATH_CIRCUIT_ZKEY);
    console.timeEnd('Proof time')
    // console.log(publicSignals)
    var result = await snarkjsOriginal.groth16.verify(vKey, publicSignals, proof);
    if (result === true) {
        console.log("Proof verification OK");
    } else {
        console.log("Invalid proof. Regenerating...");
    }
  } while (result !== true)

  const solProof = websnarkUtils.toSolidityInput(proof).proof

  const args = [
    toHex(input.root),
    toHex(input.nullifierHash),
    toHex(input.recipient, 20),
    toHex(input.relayer, 20),
    toHex(input.fee),
    toHex(input.refund),
  ]

  return { solProof, args }
}

async function setAccount(privateKey){
  const account = web3_origin.eth.accounts.privateKeyToAccount(privateKey)
    
  web3_destination.eth.accounts.wallet.add(privateKey)
  web3_origin.eth.accounts.wallet.add(privateKey)

  current_account = account.address
  // console.log(`Your public key is: ${current_account}`)
}

async function init(){
  let origin_contract_json, destination_contract_json
  let origin_contract_address, destination_contract_address

  ETH_AMOUNT = process.env.ETH_AMOUNT
  MERKLE_TREE_HEIGHT = process.env.MERKLE_TREE_HEIGHT
  ORIGIN_NETWORK_ID = process.env.ORIGIN_NETWORK_ID
  DESTINATION_NETWORK_ID = process.env.DESTINATION_NETWORK_ID

  web3_origin = new Web3(process.env.ORIGIN_ENDPOINT_WS)
  web3_destination = new Web3(process.env.DESTINATION_ENDPOINT_WS)

  origin_contract_json = require(PATH_ORIGIN_CONTRACT)
  destination_contract_json = require(PATH_DESTINATION_CONTRACT)

  origin_contract_address = origin_contract_json.networks[ORIGIN_NETWORK_ID].address
  destination_contract_address = destination_contract_json.networks[DESTINATION_NETWORK_ID].address
  
  origin_contract = new web3_origin.eth.Contract(origin_contract_json.abi, origin_contract_address)
  destination_contract = new web3_destination.eth.Contract(destination_contract_json.abi, destination_contract_address)

  await setAccount(process.env.WALLET_PRIVATE_KEY)
  // console.log("Contract address in origin network: ", origin_contract_address)
  // console.log("Contract address in destination network: ", destination_contract_address)
  // console.log("Before using commands, set the wallet by command setacc <PRIVATE_KEY>")
}

async function main(){
  program
    .command('balance <address>')
    .option('-t, --token', 'print balance of bridged assets in destination network')
    .option('-o, --origin', 'print balance of wallet in origin network')
    .option('-d, --destination', 'print balance of wallet in destination network')
    .description('Print balance of wallet. Use option -o or -d to print balance of stated address in origin/destination network respectively. To print balance of bridged assets in destination network use option -t')
    .action(async (address, options) => {
      await init()
      if(options.token){
        await printDestinationERC20Balance(address)
      }
      else if(options.origin)
        await printOriginBalance(address)
      else if(options.destination)
        await printDestinationBalance(address)
      else
        console.log('Missing option :>> try command balance --help')
    })

  program
    .command('deposit')
    .description('Submit a deposit and print secret and nullifier. Env variable WALLET_PRIVATE_KEY must be set to the private key of wallet from which the deposit amount will be charged.')
    .action(async () => {
      await init()
      await deposit()
    })

  program
    .command('withdraw <secret> <nullifier> <recipient>')
    .description('Withdraw to a recipient token account in destination network using secret and nullifier. Env variable WALLET_PRIVATE_KEY must be set to pay gas only.')
    .action(async (secret, nullifier, recipient) => {
      await init()
      await withdrawToDestination({nullifier, secret, recipient})
    })

  program
    .command('reclaim <recipient> <amount>')
    .description('Withdraw bridged assets back to the origin network. Env variable WALLET_PRIVATE_KEY must be set to the private key of the owner of tokens on destination network. Amount should be in ETH')
    .action(async (recipient, amount) => {
      await init()
      await withdrawToOrigin(recipient, amount)
    })

  try {
    await program.parseAsync(process.argv)
    process.exit(0)
  } catch (e) {
    console.log('Error:', e)
    process.exit(1)
  }
}

main()
