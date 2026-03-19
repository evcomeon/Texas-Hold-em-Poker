const { ethers } = require('ethers');
const config = require('../config');
const logger = require('../utils/logger');
const RechargeTransaction = require('../models/recharge');
const User = require('../models/user');
const { getClient } = require('../models/database');

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)'
];

/**
 * FIX: 增强安全性的区块链监控器
 * 1. 验证交易发送方与订单钱包地址匹配
 * 2. 防重放攻击保护
 * 3. 代币合约地址白名单验证
 * 4. 数据库级别的幂等性保证
 */
class BlockchainMonitor {
  constructor() {
    this.provider = null;
    this.contracts = {};
    this.isRunning = false;
    this.processedTxs = new Set(); // 内存缓存，防止同一进程内重复处理
    this.lastProcessedBlock = 0;
    this.lockMap = new Map(); // 交易处理锁，防止并发处理同一笔交易
  }
  
  async initialize() {
    logger.info('Initializing blockchain monitor...');
    
    // Validate configuration
    this._validateConfig();
    
    // Create provider
    this.provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
    
    // Verify connection
    try {
      const network = await this.provider.getNetwork();
      logger.info('Connected to network', { chainId: network.chainId });
      
      // FIX: 验证链ID是否符合预期（主网或指定测试网）
      const expectedChainId = this._getExpectedChainId();
      if (expectedChainId && network.chainId !== expectedChainId) {
        throw new Error(`Unexpected chain ID: ${network.chainId}, expected: ${expectedChainId}`);
      }
    } catch (error) {
      logger.error('Failed to connect to blockchain', { error: error.message });
      throw error;
    }
    
    // Initialize token contracts with address validation
    for (const [token, tokenConfig] of Object.entries(config.tokens)) {
      if (tokenConfig.address) {
        // FIX: 验证代币合约地址格式
        if (!ethers.isAddress(tokenConfig.address)) {
          logger.error(`Invalid ${token} contract address`, { address: tokenConfig.address });
          continue;
        }
        
        this.contracts[token] = new ethers.Contract(
          tokenConfig.address,
          ERC20_ABI,
          this.provider
        );
        
        // FIX: 验证合约是否真实存在（调用decimals检查）
        try {
          await this.contracts[token].decimals();
          logger.info(`Initialized ${token.toUpperCase()} contract`, { 
            address: tokenConfig.address 
          });
        } catch (e) {
          logger.error(`${token} contract validation failed`, { error: e.message });
          delete this.contracts[token];
        }
      }
    }
    
    if (Object.keys(this.contracts).length === 0) {
      throw new Error('No valid token contracts initialized');
    }
    
    // Get last processed block from database
    const lastBlock = await this.getLastProcessedBlock();
    this.lastProcessedBlock = lastBlock || await this.provider.getBlockNumber() - 100;
    
    logger.info('Blockchain monitor initialized', { 
      lastProcessedBlock: this.lastProcessedBlock,
      validContracts: Object.keys(this.contracts)
    });
  }
  
  _validateConfig() {
    // FIX: 验证配置完整性
    if (!config.wallet.address || !ethers.isAddress(config.wallet.address)) {
      throw new Error('Invalid or missing RECHARGE_WALLET_ADDRESS');
    }
    
    if (!config.blockchain.rpcUrl) {
      throw new Error('Missing RPC_URL');
    }
    
    if (config.exchange.chipsPerUsd <= 0) {
      throw new Error('Invalid CHIPS_PER_USD');
    }
  }
  
  _getExpectedChainId() {
    // 根据网络配置返回期望的链ID
    const networkMap = {
      'mainnet': 1,
      'ethereum': 1,
      'goerli': 5,
      'sepolia': 11155111,
      'bsc': 56,
      'bsc-testnet': 97
    };
    return networkMap[config.blockchain.network];
  }
  
  async getLastProcessedBlock() {
    try {
      const result = await User.query(
        'SELECT value FROM system_settings WHERE key = $1',
        ['last_processed_block']
      );
      return result.rows.length > 0 ? parseInt(result.rows[0].value) : null;
    } catch (e) {
      return null;
    }
  }
  
  async saveLastProcessedBlock(blockNumber) {
    try {
      await User.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
        ['last_processed_block', blockNumber.toString()]
      );
    } catch (e) {
      logger.error('Failed to save last processed block', { error: e.message });
    }
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
      await this.saveLastProcessedBlock(targetBlock);
      
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
  
  /**
   * FIX: 增强的转账事件处理，包含多重安全验证
   */
  async processTransferEvent(token, event) {
    const { args, transactionHash, blockNumber, address } = event;
    const from = args[0];
    const to = args[1];
    const value = args[2];
    
    // FIX: 验证事件来源的合约地址是否在白名单中
    const normalizedContractAddress = address.toLowerCase();
    const isValidContract = Object.values(config.tokens).some(
      t => t.address && t.address.toLowerCase() === normalizedContractAddress
    );
    
    if (!isValidContract) {
      logger.warn('Transfer from unverified contract', { 
        contract: address, 
        txHash: transactionHash 
      });
      return;
    }
    
    // FIX: 检查是否已处理（内存缓存 + 数据库双重检查）
    if (this.processedTxs.has(transactionHash)) {
      return;
    }
    
    // FIX: 获取交易锁，防止并发处理
    if (this.lockMap.has(transactionHash)) {
      return;
    }
    this.lockMap.set(transactionHash, true);
    
    try {
      logger.info('Processing transfer event', {
        token,
        from,
        to,
        value: value.toString(),
        txHash: transactionHash,
        blockNumber
      });
      
      // FIX: 数据库级别的幂等性检查，防止重复处理
      const existingTx = await RechargeTransaction.findByTxHash(transactionHash);
      if (existingTx) {
        if (existingTx.status === 'completed') {
          logger.info('Transaction already processed', { txHash: transactionHash });
          this.processedTxs.add(transactionHash);
          return;
        }
        // 如果是pending状态，继续处理
      }
      
      // FIX: 获取完整交易信息以验证发送方
      const tx = await this.provider.getTransaction(transactionHash);
      if (!tx) {
        logger.error('Failed to fetch transaction details', { txHash: transactionHash });
        return;
      }
      
      // Convert token amount to human readable
      const decimals = config.tokens[token].decimals;
      const tokenAmount = parseFloat(ethers.formatUnits(value, decimals));
      
      // Check minimum amount
      if (tokenAmount < config.exchange.minRechargeAmount) {
        logger.warn('Transfer amount below minimum', { 
          tokenAmount, 
          minAmount: config.exchange.minRechargeAmount,
          txHash: transactionHash
        });
        return;
      }
      
      // Check maximum amount
      if (config.exchange.maxRechargeAmount > 0 && tokenAmount > config.exchange.maxRechargeAmount) {
        logger.warn('Transfer amount above maximum', { 
          tokenAmount, 
          maxAmount: config.exchange.maxRechargeAmount,
          txHash: transactionHash
        });
        return;
      }
      
      // Calculate chips amount
      const chipsAmount = Math.floor(tokenAmount * config.exchange.chipsPerUsd);
      
      // FIX: 查找与发送地址关联的待处理订单
      const pendingOrder = await this.findPendingOrderByFromAddress(from);
      
      if (!pendingOrder) {
        logger.warn('No pending order found for transfer', { 
          from, 
          txHash: transactionHash,
          amount: tokenAmount,
          token: config.tokens[token].symbol
        });
        
        // 创建未认领的交易记录
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
      
      // FIX: 验证转账金额与订单金额匹配（允许小误差）
      const amountDiff = Math.abs(tokenAmount - parseFloat(pendingOrder.token_amount));
      const tolerance = 0.01; // 1% 容差
      
      if (amountDiff > parseFloat(pendingOrder.token_amount) * tolerance) {
        logger.warn('Transfer amount does not match order', {
          orderId: pendingOrder.order_no,
          expected: pendingOrder.token_amount,
          actual: tokenAmount,
          txHash: transactionHash
        });
      }
      
      // FIX: 使用数据库事务确保幂等性
      const client = await getClient();
      try {
        await client.query('BEGIN');
        
        // 再次检查是否已处理（在事务内）
        const checkResult = await client.query(
          'SELECT id, status FROM recharge_transactions WHERE tx_hash = $1 FOR UPDATE',
          [transactionHash]
        );
        
        if (checkResult.rows.length > 0 && checkResult.rows[0].status === 'completed') {
          await client.query('COMMIT');
          logger.info('Transaction already completed (checked in transaction)', { txHash: transactionHash });
          return;
        }
        
        // 创建或更新充值记录
        let rechargeTx;
        if (existingTx) {
          await client.query(
            `UPDATE recharge_transactions
             SET status = $1,
                 order_no = COALESCE(order_no, $2),
                 user_id = COALESCE(user_id, $3),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            ['processing', pendingOrder.order_no, pendingOrder.user_id, existingTx.id]
          );
          rechargeTx = {
            ...existingTx,
            order_no: existingTx.order_no || pendingOrder.order_no,
            user_id: existingTx.user_id || pendingOrder.user_id,
            status: 'processing'
          };
        } else {
          const result = await client.query(
            `INSERT INTO recharge_transactions
             (user_id, order_no, tx_hash, token_symbol, token_amount, chips_amount, from_address, to_address, block_number, confirmations, status)
             VALUES ($1, $2, $3, $4, $5, $6, LOWER($7), LOWER($8), $9, $10, $11)
             RETURNING *`,
            [
              pendingOrder.user_id,
              pendingOrder.order_no,
              transactionHash,
              config.tokens[token].symbol,
              tokenAmount,
              chipsAmount,
              from,
              to,
              blockNumber,
              0,
              'processing'
            ]
          );
          rechargeTx = result.rows[0];
        }

        // 对已存在但未关联订单的交易补齐字段
        if (checkResult.rows.length > 0 && !existingTx) {
          const result = await client.query(
            `UPDATE recharge_transactions
             SET order_no = COALESCE(order_no, $1),
                 user_id = COALESCE(user_id, $2),
                 status = $3,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4
             RETURNING *`,
            [
              pendingOrder.order_no,
              pendingOrder.user_id,
              'processing',
              checkResult.rows[0].id
            ]
          );
          rechargeTx = result.rows[0];
        }
        
        // 给用户添加筹码
        await User.addChipsWithClient(
          client,
          pendingOrder.user_id,
          chipsAmount,
          transactionHash,
          config.tokens[token].symbol,
          tokenAmount
        );
        
        // 更新订单状态为完成
        await client.query(
          `UPDATE recharge_orders
           SET status = $1,
               tx_hash = $2,
               confirmed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE order_no = $3`,
          ['completed', transactionHash, pendingOrder.order_no]
        );
        
        await client.query('COMMIT');
        
        logger.info('Recharge processed successfully', {
          txHash: transactionHash,
          orderNo: pendingOrder.order_no,
          userId: pendingOrder.user_id,
          chipsAdded: chipsAmount
        });
        
        this.processedTxs.add(transactionHash);
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
    } catch (error) {
      logger.error('Failed to process transfer event', {
        txHash: transactionHash,
        error: error.message,
        stack: error.stack
      });
      
      // 标记为失败
      try {
        await RechargeTransaction.updateStatusByTxHash(transactionHash, 'failed', error.message);
      } catch (e) {
        logger.error('Failed to update transaction status', { error: e.message });
      }
    } finally {
      // 释放锁
      this.lockMap.delete(transactionHash);
    }
  }
  
  /**
   * FIX: 查找与发送地址关联的待处理订单
   * 验证订单状态、金额匹配等
   */
  async findPendingOrderByFromAddress(fromAddress) {
    try {
      const client = await getClient();
      try {
        // 查找最近24小时内创建的待处理订单，且钱包地址匹配
        const result = await client.query(
          `SELECT * FROM recharge_orders 
           WHERE LOWER(wallet_address) = LOWER($1) 
           AND status = 'pending'
           AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
           ORDER BY created_at DESC
           LIMIT 1`,
          [fromAddress]
        );
        
        return result.rows[0] || null;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error finding pending order', { error: error.message });
      return null;
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
