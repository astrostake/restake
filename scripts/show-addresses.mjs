import 'dotenv/config'
import fs from 'fs'
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Slip10RawIndex, pathToString } from "@cosmjs/crypto";
import { Wallet as EthWallet } from "@ethersproject/wallet";
import Network from "../src/utils/Network.mjs";
import EthSigner from "../src/utils/EthSigner.mjs";
import { overrideNetworks } from "../src/utils/Helpers.mjs";

const mnemonic = process.env.MNEMONIC;

if (!mnemonic) {
  console.error("\x1b[31m[ERROR] MNEMONIC is not defined in your .env file.\x1b[0m");
  console.error("Please add your hot wallet seed phrase to .env, e.g.:");
  console.error('MNEMONIC="word1 word2 word3 ... word12"\n');
  process.exit(1);
}

// 1. Read local and default networks
function loadNetworksConfig() {
  let defaultNetworks = [];
  try {
    defaultNetworks = JSON.parse(fs.readFileSync('src/networks.json', 'utf8'));
  } catch (e) {
    defaultNetworks = [];
  }

  let localOverrides = {};
  const localPath = process.env.NETWORKS_OVERRIDE_PATH || 'src/networks.local.json';
  if (fs.existsSync(localPath)) {
    try {
      localOverrides = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    } catch (e) {
      console.warn(`\x1b[33m[WARN] Failed to parse ${localPath}: ${e.message}\x1b[0m`);
    }
  }

  const merged = overrideNetworks(defaultNetworks, localOverrides);
  const localChainNames = Object.keys(localOverrides);

  return { defaultNetworks, localOverrides, merged, localChainNames };
}

// 2. Derive address for a single network
async function resolveNetworkAddress(networkData) {
  const chainName = networkData.name || networkData.path;
  const network = new Network(networkData);

  try {
    await network.load();
  } catch (err) {
    // If not found in Cosmos Directory, check if prefix was provided locally
    if (!network.prefix && !networkData.prefix) {
      throw new Error(`Chain '${chainName}' could not be loaded from Cosmos Directory and no prefix found in local config.`);
    }
    // Fallback to local data
    network.prefix = network.prefix || networkData.prefix;
    network.slip44 = network.slip44 || networkData.slip44 || 118;
    network.prettyName = network.prettyName || networkData.prettyName || chainName;
  }

  // Determine correct slip44 derivation
  let slip44;
  if (network.data.autostake?.correctSlip44 || network.slip44 === 60) {
    slip44 = network.slip44 || 118;
  } else {
    slip44 = network.data.autostake?.slip44 || network.slip44 || 118;
  }

  const hdPath = [
    Slip10RawIndex.hardened(44),
    Slip10RawIndex.hardened(slip44),
    Slip10RawIndex.hardened(0),
    Slip10RawIndex.normal(0),
    Slip10RawIndex.normal(0),
  ];

  let address;
  let type;

  if (slip44 === 60) {
    const ethWallet = EthWallet.fromMnemonic(mnemonic);
    const ethSigner = EthSigner(null, ethWallet, network.prefix);
    address = await ethSigner.getAddress();
    type = "EVM / Ethermint (slip44: 60)";
  } else {
    const signer = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: network.prefix,
      hdPaths: [hdPath]
    });
    const [acc] = await signer.getAccounts();
    address = acc.address;
    type = `Cosmos Standard (slip44: ${slip44})`;
  }

  return {
    name: chainName,
    prettyName: network.prettyName || chainName,
    chainId: network.chainId || 'unknown',
    prefix: network.prefix,
    slip44,
    hdPath: pathToString(hdPath),
    type,
    denom: network.denom || network.baseAsset?.base?.denom || 'N/A',
    address
  };
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const showAll = flags.includes('--all');
  const asJson = flags.includes('--json');

  const { merged, localChainNames } = loadNetworksConfig();

  let targetChains = [];

  if (args.length > 0) {
    // Chains provided via CLI arguments: e.g. `npm run show-addresses lumera epix osmosis`
    targetChains = args.map(name => {
      const existing = merged.find(n => n.name === name);
      return existing || { name, path: name };
    });
  } else if (showAll) {
    // All chains from merged list
    targetChains = merged;
  } else if (localChainNames.length > 0) {
    // Default to chains in networks.local.json
    targetChains = merged.filter(n => localChainNames.includes(n.name));
  } else {
    // Fallback default
    targetChains = merged.slice(0, 5);
  }

  if (!asJson) {
    console.log("================================================================================");
    console.log("                       UNIVERSAL RESTAKE ADDRESS GENERATOR                      ");
    console.log("================================================================================");
    console.log(`Tip: Specify any chains: npm run show-addresses <chain1> <chain2> ...`);
    console.log(`     Use --all to list all chains, or --json for JSON output.\n`);
  }

  const results = [];

  for (const item of targetChains) {
    try {
      const res = await resolveNetworkAddress(item);
      results.push(res);
      if (!asJson) {
        console.log(`▸ \x1b[1m\x1b[36m${res.prettyName}\x1b[0m (\x1b[33m${res.name}\x1b[0m)`);
        console.log(`  Chain ID      : ${res.chainId}`);
        console.log(`  Prefix        : ${res.prefix}`);
        console.log(`  Derivation    : ${res.hdPath} (${res.type})`);
        console.log(`  Primary Denom : ${res.denom}`);
        console.log(`  \x1b[32mBot Address   : ${res.address}\x1b[0m\n`);
      }
    } catch (e) {
      if (!asJson) {
        console.log(`▸ \x1b[31m[FAILED] ${item.name || item}\x1b[0m: ${e.message}\n`);
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("================================================================================");
    console.log("Ready! Use these Bot Addresses for gas funding and your validator-registry PR.");
    console.log("================================================================================");
  }
}

main().catch(err => {
  console.error("Execution failed:", err);
  process.exit(1);
});
