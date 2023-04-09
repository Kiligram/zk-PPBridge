# zk-PPBridge: A Zero-Knowledge-Proof-Based Privacy-Preserving Bridge for Cryptocurrency Networks


## Preliminaries

1. Nodejs v19.6.0 (not tested on other versions)
2. Working directory is the root of this solution
3. `npm install -g npx`

&nbsp;
# Quick start
1\. Install dependencies:
```
npm install
```

2\. Set all neccessary env variables in .env file.

3\. Deploy the contracts:
```
npm run migrate
```

4\. Run relayer:
```
node .\bridge_relayer\relayer.js
```

5\. Now the console app can be used. Get help:
```
node .\src\cli.js --help
```
