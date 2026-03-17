const { ethers } = require('ethers');
const config = require('../config');
const logger = require('../utils/logger');
const RechargeTransaction = require('../models/recharge');
const User = require('../models/user');

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)'
];

class BlockchainMonitor {
  constructor() {
    this.provider = null;
    this.contracts = {};
    this.isRunning = false;
    this.processedTxs = new Set();
    this.lastProcessedBlock = 0;
  }
  
  async initialize() {
    logger.info('Initializing blockchain monitor...');
    
    // Create provider
    this.provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
    
    // Verify connection
    try {
      const network = await this.provider.getNetwork();
      logger.info('Connected to network', { chainId: network.chainId });
    } catch (error) {
      logger.error('Failed to connect to blockchain', { error: error.message });
      throw error;
    }
    
    // Initialize token contracts
    for (const [token, tokenConfig] of Object.entries(config.tokens)) {
      if (tokenConfig.address) {
        this.contracts[token] = new ethers.Contract(
          tokenConfig.address,
          ERC20_ABI,
          this.provider
        );
        logger.info(`Initialized ${token.toUpperCase()} contract`, { 
          address: tokenConfig.address 
        });
      }
    }
    
    // Get last processed block from database or use current block
    const lastBlock = await this.getLastProcessedBlock();
    this.lastProcessedBlock = lastBlock || await this.provider.getBlockNumber() - 100;
    
    logger.info('Blockchain monitor initialized', { 
      lastProcessedBlock: this.lastProcessedBlock 
    });
  }
  
  async getLastProcessedBlock() {
    // In production, store this in database
    // For now, return null to start from current block - 100
    return null;
  }
  
  async start() {
    if (this.isRunning) {
      logger.warn('Monitor is already running');
      return;
    }
    
    this.isRunning = true;
    logger.info('Starting blockchain monitor...');
    
    // Start polling for new blocks
    this.pollInterval = setInterval(
      () => this.poll(),
      config.blockchain.pollingInterval
    );
    
    // Initial poll
    await this.poll();
  }
  
  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    logger.info('Blockchain monitor stopped');
  }
  
  async poll() {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const targetBlock = currentBlock - config.blockchain.confirmationBlocks;
      
      if (targetBlock <= this.lastProcessedBlock) {
        return;
      }
      
      logger.debug('Processing blocks', {
        from: this.lastProcessedBlock + 1,
        to: targetBlock
      });
      
      // Process each token contract
      for (const [token, contract] of Object.entries(this.contracts)) {
        await this.processTokenTransfers(token, contract, this.lastProcessedBlock + 1, targetBlock);
      }
      
      this.lastProcessedBlock = targetBlock;
      
    } catch (error) {
      logger.error('Error during polling', { error: error.message });
    }
  }
  
  async processTokenTransfers(token, contract, fromBlock, toBlock) {
    try {
      // Create filter for transfers to our wallet
      const filter = contract.filters.Transfer(null, config.wallet.address);
      
      // Query events
      const events = await contract.queryFilter(filter, fromBlock, toBlock);
      
      logger.debug(`Found ${events.length} ${token.toUpperCase()} transfer events`);
      
      for (const event of events) {
        await this.processTransferEvent(token, event);
      }
      
    } catch (error) {
      logger.error(`Error processing ${token} transfers`, { error: error.message });
    }
  }
  
  async processTransferEvent(token, event) {
    const { args, transactionHash, blockNumber } = event;
    const from = args[0];
    const to = args[1];
    const value = args[2];
    
    // Skip if already processed
    if (this.processedTxs.has(transactionHash)) {
      return;
    }
    
    logger.info('Processing transfer event', {
      token,
      from,
      to,
      value: value.toString(),
      txHash: transactionHash,
      blockNumber
    });
    
    // Check if transaction already exists in database
    const existingTx = await RechargeTransaction.findByTxHash(transactionHash);
    if (existingTx) {
      this.processedTxs.add(transactionHash);
      return;
    }
    
    // Convert token amount to human readable
    const decimals = config.tokens[token].decimals;
    const tokenAmount = parseFloat(ethers.formatUnits(value, decimals));
    
    // Check minimum amount
    if (tokenAmount < config.exchange.minRechargeAmount) {
      logger.warn('Transfer amount below minimum', { 
        tokenAmount, 
        minAmount: config.exchange.minRechargeAmount 
      });
      return;
    }
    
    // Check maximum amount
    if (config.exchange.maxRechargeAmount > 0 && tokenAmount > config.exchange.maxRechargeAmount) {
      logger.warn('Transfer amount above maximum', { 
        tokenAmount, 
        maxAmount: config.exchange.maxRechargeAmount 
      });
      return;
    }
    
    // Calculate chips amount
    const chipsAmount = Math.floor(tokenAmount * config.exchange.chipsPerUsd);
    
    // Find user by wallet address
    // In production, you'd have a user_wallets table
    // For now, we'll use a mapping stored somewhere
    const userId = await this.findUserByWallet(from);
    
    if (!userId) {
      logger.warn('No user found for wallet address', { from });
      // Still create the transaction but mark as 'unclaimed'
      await RechargeTransaction.create({
        userId: null,
        txHash: transactionHash,
        tokenSymbol: config.tokens[token].symbol,
        tokenAmount,
        chipsAmount,
        fromAddress: from,
        toAddress: to,
        blockNumber,
        status: 'unclaimed'
      });
      return;
    }
    
    // Create recharge transaction
    const rechargeTx = await RechargeTransaction.create({
      userId,
      txHash: transactionHash,
      tokenSymbol: config.tokens[token].symbol,
      tokenAmount,
      chipsAmount,
      fromAddress: from,
      toAddress: to,
      blockNumber,
      status: 'pending'
    });
    
    // Process the recharge immediately
    await this.processRecharge(rechargeTx);
    
    this.processedTxs.add(transactionHash);
  }
  
  async findUserByWallet(walletAddress) {
    // In production, query user_wallets table
    // For now, return null - this should be implemented based on your user wallet mapping
    // Example: const result = await query('SELECT user_id FROM user_wallets WHERE wallet_address = $1', [walletAddress.toLowerCase()]);
    return null;
  }
  
  async processRecharge(rechargeTx) {
    try {
      if (!rechargeTx.userId) {
        logger.warn('Cannot process recharge without user ID', { txHash: rechargeTx.tx_hash });
        return;
      }
      
      // Add chips to user
      await User.addChips(
        rechargeTx.user_id,
        rechargeTx.chips_amount,
        rechargeTx.tx_hash,
        rechargeTx.token_symbol,
        rechargeTx.token_amount
      );
      
      logger.info('Recharge processed successfully', {
        txHash: rechargeTx.tx_hash,
        userId: rechargeTx.user_id,
        chipsAdded: rechargeTx.chips_amount
      });
      
    } catch (error) {
      logger.error('Failed to process recharge', {
        txHash: rechargeTx.tx_hash,
        error: error.message
      });
      
      // Mark as failed
      await RechargeTransaction.updateStatus(rechargeTx.id, 'failed');
    }
  }
  
  // Manual check for a specific transaction
  async checkTransaction(txHash) {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return { status: 'not_found' };
      }
      
      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;
      
      // Check if it's a transfer to our wallet
      for (const [token, contract] of Object.entries(this.contracts)) {
        const logs = receipt.logs.filter(log => 
          log.address.toLowerCase() === contract.target.toLowerCase()
        );
        
        for (const log of logs) {
          try {
            const parsedLog = contract.interface.parseLog(log);
            if (parsedLog && parsedLog.name === 'Transfer') {
              const to = parsedLog.args[1];
              if (to.toLowerCase() === config.wallet.address.toLowerCase()) {
                return {
                  status: 'found',
                  token,
                  from: parsedLog.args[0],
                  to: parsedLog.args[1],
                  value: parsedLog.args[2].toString(),
                  blockNumber: receipt.blockNumber,
                  confirmations,
                  confirmed: confirmations >= config.blockchain.confirmationBlocks
                };
              }
            }
          } catch (e) {
            // Not a matching event
          }
        }
      }
      
      return { status: 'not_transfer_to_us' };
      
    } catch (error) {
      logger.error('Error checking transaction', { txHash, error: error.message });
      return { status: 'error', error: error.message };
    }
  }
}

module.exports = BlockchainMonitor;
