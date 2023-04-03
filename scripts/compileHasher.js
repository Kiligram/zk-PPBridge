// Generates Hasher artifact at compile-time using Truffle's external compiler
// mechanism
const path = require('path')
const fs = require('fs')
const genContract = require('./mimcsponge_hasher/mimcsponge_gencontract.js')

// where Truffle will expect to find the results of the external compiler
// command
const outputPath = path.join(__dirname, '..', 'build', 'Hasher.json')

if (!fs.existsSync(path.join(__dirname, '..', 'build'))){
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
}

function main() {
  const contract = {
    contractName: 'Hasher',
    abi: genContract.abi,
    bytecode: genContract.createCode('mimcsponge', 220),
  }

  fs.writeFileSync(outputPath, JSON.stringify(contract))
}

main()
