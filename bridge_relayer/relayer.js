require('dotenv').config({ path: __dirname + '/../.env' })
const Web3 = require('web3')

const PATH_ORIGIN_CONTRACT = __dirname + '/../build/contracts/OriginWrappedETH.json'
const PATH_DESTINATION_CONTRACT = __dirname + '/../build/contracts/DestinationWrappedETH.json'

let ORIGIN_NETWORK_ID, DESTINATION_NETWORK_ID

let web3_origin, web3_destination, origin_contract, destination_contract
let bridge_address

const handleOriginDepositEvent = async (event) => {
    const root = event.returnValues.root

    console.log(`New deposit event. The new root is :>> ${root}`)
    const trx = destination_contract.methods.submitRoot(root)

    const gas = await trx.estimateGas({ from: bridge_address })
    console.log('estimated gas :>> ', gas)

    trx.send({ from: bridge_address, gas: Math.floor(gas * 1.2) })
    .on('transactionHash', function (txHash) {
        console.log(`The transaction hash is ${txHash}`)
    }).on('error', function (e) {
        console.error('on transactionHash error', e.message)
    })

}

const handleDestinationReclaimEvent = async (event) => {
    const recipient = event.returnValues.recipient
    const amount = event.returnValues.amount

    console.log(`New withdraw event :>> to: ${recipient}, amount: ${amount}`)

    const trx = origin_contract.methods.releaseFunds(recipient, amount)

    const gas = await trx.estimateGas({ from: bridge_address })
    console.log('estimated gas :>> ', gas)

    trx.send({ from: bridge_address, gas: Math.floor(gas * 1.2) })
    .on('transactionHash', function (txHash) {
        console.log(`The transaction hash is ${txHash}`)
    }).on('error', function (e) {
        console.error('on transactionHash error', e.message)
    })
}

async function init(){
    let origin_contract_json, destination_contract_json
    let origin_contract_address, destination_contract_address
    let private_key

    private_key = process.env.BRIDGE_PRIVATE_KEY
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
  
    web3_destination.eth.accounts.wallet.add(private_key)
    web3_origin.eth.accounts.wallet.add(private_key)

    bridge_address = web3_origin.eth.accounts.privateKeyToAccount(private_key).address

    console.log('Bridge address :>> ', bridge_address)
    console.log('oriNetworkId :>> ', await web3_origin.eth.net.getId())
    console.log('destNetworkId :>> ', await web3_destination.eth.net.getId())
    console.log("Contract address in origin network :>> ", origin_contract_address)
    console.log("Contract address in destination network :>> ", destination_contract_address)
}

const main = async () => {
    await init()

    origin_contract.events.Deposit()
        .on('data', async (event) => {
            await handleOriginDepositEvent(event)
        })
        .on('error', (err) => {
            console.error('Error: ', err)
        })
    console.log(`Waiting for deposit events in origin network`)

    destination_contract.events.Reclaim()
        .on('data', async (event) => {
            await handleDestinationReclaimEvent(event)
        })
        .on('error', (err) => {
            console.error('Error: ', err)
        })

    console.log(`Waiting for reclaim events in destination network`)
}

main()
