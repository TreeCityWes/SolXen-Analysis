const { Connection, PublicKey } = require('@solana/web3.js');
const prompt = require('prompt-sync')();
const axios = require('axios');
const colors = require('colors');
const Table = require('cli-table3');

// Color scheme
colors.setTheme({
  title: ['cyan', 'bold'],
  subtitle: ['yellow', 'bold'],
  info: 'white',
  success: 'green',
  error: 'red',
  highlight: 'magenta',
});

// Replace with your actual QuickNode RPC endpoint or use a public one for testing
const RPC_ENDPOINT =
  'ENTER_RPC_ENDPOINT(QuickNode or Other)';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// Constants
const MINER_PROGRAM_ID = 'B8HwMYCk1o7EaJhooM4P43BHSk5M8zZHsTeJixqw7LMN';
const SOLXEN_TOKEN_ADDRESS =
  '6f8deE148nynnSiWshA9vLydEbJGpDeKh5G4PRgjmzG7'; // SolXEN token address

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function batchGetTransactions(signatures) {
  const batchSize = 20;
  let allTransactions = [];

  for (let i = 0; i < signatures.length; i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);
    const batchRequests = batch.map((sig, index) => ({
      jsonrpc: '2.0',
      id: i + index,
      method: 'getTransaction',
      params: [
        sig,
        { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      ],
    }));

    try {
      const response = await axios.post(RPC_ENDPOINT, batchRequests);
      const batchTransactions = response.data.map((item) => item.result);
      allTransactions = allTransactions.concat(batchTransactions);
    } catch (error) {
      console.error(`Error in batch request: ${error.message}.`.error);
    }

    await sleep(500); // Delay to prevent rate limiting
  }

  return allTransactions;
}

async function getRecentMiningTransactions(limit = 100) {
  console.log(
    `\n[${new Date().toLocaleTimeString()}] Fetching the last ${limit} mining transactions involving the miner program...`
      .info
  );
  const minerProgramPubkey = new PublicKey(MINER_PROGRAM_ID);

  try {
    const signatures = await connection.getSignaturesForAddress(
      minerProgramPubkey,
      { limit }
    );
    console.log(
      `[${new Date().toLocaleTimeString()}] Fetched ${signatures.length} signatures.`
        .info
    );

    const transactions = await batchGetTransactions(
      signatures.map((sig) => sig.signature)
    );

    let miningTransactions = transactions
      .map((tx, index) => ({
        signature: signatures[index].signature,
        blockTime: signatures[index].blockTime,
        transaction: tx,
      }))
      .filter((tx) => tx.transaction !== null);

    console.log(
      `\n[${new Date().toLocaleTimeString()}] Collected ${miningTransactions.length} mining transactions.`
        .info
    );
    return miningTransactions;
  } catch (error) {
    console.error(
      `Error fetching recent mining transactions: ${error.message}.`.error
    );
    throw error;
  }
}

function extractMiningInfo(transaction) {
  const fee = transaction?.meta?.fee || 0;
  const computeUnitsConsumed = transaction?.meta?.computeUnitsConsumed || 0;
  let computeUnitPrice = 0;

  const instructions = transaction?.transaction?.message?.instructions || [];
  for (const ix of instructions) {
    if (
      ix?.programId?.toString() ===
      'ComputeBudget111111111111111111111111111111'
    ) {
      const data = Buffer.from(ix.data, 'base64');
      if (data[0] === 3) {
        // SetComputeUnitPrice instruction
        computeUnitPrice = data.readUInt32LE(1) / 1_000_000; // Convert from micro-lamports to lamports
      }
    }
  }

  // Fallback to 1 lamport if computeUnitPrice is 0
  if (computeUnitPrice === 0) {
    computeUnitPrice = 1;
  }

  const computeCost = (computeUnitsConsumed * computeUnitPrice) / 1e9; // Convert to SOL
  const totalCostSol = fee / 1e9 + computeCost;

  let hashesFound = 0;
  let superHashesFound = 0;

  const logMessages = transaction?.meta?.logMessages || [];
  for (const msg of logMessages) {
    if (msg.includes("Found '42069'")) {
      hashesFound += 1;
      superHashesFound += 1;
    } else if (msg.includes("Found '420'")) {
      hashesFound += 1;
    }
  }

  const minerAddress =
    transaction?.transaction?.message?.accountKeys?.[0]?.toString() ||
    'Unknown Miner';

  return {
    minerAddress,
    fee: fee / 1e9, // Convert to SOL
    computeUnitsConsumed,
    computeUnitPrice,
    computeCost,
    hashesFound,
    superHashesFound,
    totalCostSol,
  };
}

async function analyzeMiningCosts(amp) {
  const transactions = await getRecentMiningTransactions(100);

  let totalCostSol = 0;
  let totalHashesFound = 0;
  let totalSuperHashesFound = 0;
  let miners = new Set();
  let highestHashCount = 0;
  let lowestHashCount = Infinity;
  let highestCost = 0;
  let lowestCost = Infinity;

  for (const tx of transactions) {
    const miningInfo = extractMiningInfo(tx.transaction);
    totalCostSol += miningInfo.totalCostSol;
    totalHashesFound += miningInfo.hashesFound;
    totalSuperHashesFound += miningInfo.superHashesFound;

    miners.add(miningInfo.minerAddress);

    highestHashCount = Math.max(highestHashCount, miningInfo.hashesFound);
    lowestHashCount = Math.min(lowestHashCount, miningInfo.hashesFound);
    highestCost = Math.max(highestCost, miningInfo.totalCostSol);
    lowestCost = Math.min(lowestCost, miningInfo.totalCostSol);
  }

  const averageHashesPerTx = totalHashesFound / transactions.length;
  const averageCostPerTx = totalCostSol / transactions.length;

  // Mining Transaction Summary Table
  const miningSummaryTable = new Table({
    head: ['Metric', 'Value'],
    style: { head: ['yellow'] },
  });

  miningSummaryTable.push(
    ['Total Transactions Analyzed', transactions.length],
    ['Unique Miners Involved', miners.size],
    ['Average Hashes per Transaction', averageHashesPerTx.toFixed(2)],
    ['Highest Hash Count in a Transaction', highestHashCount],
    ['Lowest Hash Count in a Transaction', lowestHashCount],
    ['Average Cost per Transaction (SOL)', averageCostPerTx.toFixed(9)],
    ['Highest Cost in a Transaction (SOL)', highestCost.toFixed(9)],
    ['Lowest Cost in a Transaction (SOL)', lowestCost.toFixed(9)]
  );

  console.log('\nMining Transaction Summary:'.subtitle);
  console.log(miningSummaryTable.toString());

  // Mining Cost Analysis Table
  const miningCostTable = new Table({
    head: ['Metric', 'Value'],
    style: { head: ['yellow'] },
  });

  const costPerHash = totalHashesFound
    ? totalCostSol / totalHashesFound
    : 0;

  miningCostTable.push(
    ['Total Mining Cost (SOL)', totalCostSol.toFixed(9)],
    ['Total Hashes Found', totalHashesFound],
    ['Total Superhashes Found', totalSuperHashesFound],
    ['Cost per Hash Found (SOL)', costPerHash.toFixed(9)]
  );

  console.log('\nMining Cost Analysis:'.subtitle);
  console.log(miningCostTable.toString());

  const solXENPerHash = 420 * amp;
  const solXENPerSuperHash = 42069 * amp;
  const totalSolXENFromHashes =
    solXENPerHash * (totalHashesFound - totalSuperHashesFound);
  const totalSolXENFromSuperHashes =
    solXENPerSuperHash * totalSuperHashesFound;
  const totalSolXENMinted =
    totalSolXENFromHashes + totalSolXENFromSuperHashes;

  const costPer100kSolXEN = totalSolXENMinted
    ? (totalCostSol / totalSolXENMinted) * 100000
    : 0;

  // SolXEN Minting Details Table
  const mintingDetailsTable = new Table({
    head: ['Metric', 'Value'],
    style: { head: ['yellow'] },
  });

  mintingDetailsTable.push(
    ['SolXEN per Hash', solXENPerHash],
    ['SolXEN per Superhash', solXENPerSuperHash],
    ['Total SolXEN from Hashes', totalSolXENFromHashes],
    ['Total SolXEN from Superhashes', totalSolXENFromSuperHashes],
    ['Estimated Total SolXEN Minted', totalSolXENMinted],
    ['Cost per 100,000 SolXEN (SOL)', costPer100kSolXEN.toFixed(9)]
  );

  console.log(`\nSolXEN Minting Details with AMP = ${amp}:`.subtitle);
  console.log(mintingDetailsTable.toString());

  return { costPer100kSolXEN, totalSolXENMinted };
}

async function getJupiterQuote() {
  const inputMint = 'So11111111111111111111111111111111111111112'; // SOL mint address
  const outputMint = SOLXEN_TOKEN_ADDRESS; // SolXEN token address
  const amount = 100_000_000; // 0.1 SOL in lamports

  try {
    const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps: 50, // Set slippage tolerance
        onlyDirectRoutes: false, // Ensure all routes are considered
      },
    });

    const data = response.data;

    if (
      data === undefined ||
      data.inAmount === undefined ||
      data.outAmount === undefined
    ) {
      throw new Error('Missing inAmount or outAmount in the API response.');
    }

    // Correct token decimals
    const SOL_DECIMALS = 9;
    const SOLXEN_DECIMALS = 6; // Corrected to 6 decimals

    const inAmountSOL =
      parseInt(data.inAmount, 10) / Math.pow(10, SOL_DECIMALS);
    const outAmountSolXEN =
      parseInt(data.outAmount, 10) / Math.pow(10, SOLXEN_DECIMALS);

    // Calculate cost of 100,000 SolXEN
    const costOf100kSolXEN = (100_000 * inAmountSOL) / outAmountSolXEN;

    // Jupiter Swap Quote Table
    const jupiterQuoteTable = new Table({
      head: ['Metric', 'Value'],
      style: { head: ['yellow'] },
    });

    const priceImpact = data.priceImpactPct
      ? parseFloat(data.priceImpactPct) * 100
      : 0;

    jupiterQuoteTable.push(
      ['Input (SOL)', inAmountSOL.toFixed(9)],
      ['Output (SolXEN)', outAmountSolXEN.toFixed(6)],
      ['Price Impact (%)', priceImpact.toFixed(2)],
      ['Cost of 100,000 SolXEN (SOL)', costOf100kSolXEN.toFixed(9)]
    );

    console.log('\nJupiter Swap Quote:'.subtitle);
    console.log(jupiterQuoteTable.toString());

    return { inAmountSOL, outAmountSolXEN, costOf100kSolXEN };
  } catch (error) {
    console.error('Error fetching Jupiter quote:'.error, error.message);
    return null;
  }
}

async function main() {
  console.log('Starting SolXEN Mining Cost Analysis'.title);
  console.log('==================================='.title);

  const ampInput = prompt(
    'Enter the current AMP value (e.g., 300): '.info
  );
  let amp = ampInput ? Number(ampInput) : null;

  if (!amp || isNaN(amp)) {
    console.log(
      'Invalid AMP value provided. Please run the script again and enter a valid AMP.'
        .error
    );
    return;
  }

  console.log(`\nUsing AMP value: ${amp}`.info);

  const { costPer100kSolXEN } = await analyzeMiningCosts(amp);

  const jupiterQuote = await getJupiterQuote();

  if (jupiterQuote) {
    const marketValue = jupiterQuote.costOf100kSolXEN;
    const miningCost = costPer100kSolXEN;
    const profitOrLoss = miningCost - marketValue;
    const isProfitable = profitOrLoss < 0;
    const difference = Math.abs(profitOrLoss);
    const percentageDifference = (difference / marketValue) * 100;

    // Comparison Table
    const comparisonTable = new Table({
      head: ['Metric', 'Value'],
      style: { head: ['yellow'] },
    });

    comparisonTable.push(
      ['Cost to Mine 100,000 SolXEN (SOL)', miningCost.toFixed(9)],
      ['Cost to Buy 100,000 SolXEN (SOL)', marketValue.toFixed(9)],
      [
        isProfitable ? 'Profit (SOL)' : 'Loss (SOL)',
        difference.toFixed(9),
      ],
      ['Difference (%)', `${percentageDifference.toFixed(2)}%`],
      ['Mining is Profitable?', isProfitable ? 'Yes' : 'No']
    );

    console.log('\nComparison:'.subtitle);
    console.log(comparisonTable.toString());
  }

  console.log('\nAnalysis complete.'.title);
}

process.on('unhandledRejection', (error) => {
  console.error('\nAn unhandled error occurred:'.error);
  console.error(error.stack.error);
  process.exit(1);
});

main().catch((error) => {
  console.error('\nAn error occurred during script execution:'.error);
  console.error(error.stack.error);
  process.exit(1);
});
