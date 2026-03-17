const { ethers } = require('ethers');
const RechargeOrder = require('../models/recharge');
const logger = require('../utils/logger');

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

class OrderVerifier {
  constructor() {
    this.provider = null;
    this.isRunning = false;
    this.interval = null;
    
    this.config = {
      rpcUrl: process.env.RPC_URL || 'https://eth.llamarpc.com',
      confirmationBlocks: parseInt(process.env.CONFIRMATION_BLOCKS) || 3,
      checkInterval: parseInt(process.env.ORDER_CHECK_INTERVAL) || 5000,
      usdtAddress: process.env.USDT_CONTRACT_ADDRESS || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      usdcAddress: process.env.USDC_CONTRACT_ADDRESS || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      walletAddress: process.env.RECHARGE_WALLET_ADDRESS
    };
  }

  async initialize() {
    try {
      this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      const network = await this.provider.getNetwork();
      logger.info(`Order verifier connected to network: ${network.chainId}`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize order verifier:', error);
      return false;
    }
  }

  start() {
    if (this.isRunning) {
      logger.warn('Order verifier is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting order verifier...');

    this.interval = setInterval(() => {
      this.verifyPendingOrders().catch(err => {
        logger.error('Error verifying orders:', err);
      });
    }, this.config.checkInterval);

    // 立即执行一次
    this.verifyPendingOrders().catch(err => {
      logger.error('Error in initial verification:', err);
    });
  }

  stop() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('Order verifier stopped');
  }

  async verifyPendingOrders() {
    try {
      const pendingOrders = await RechargeOrder.findPending(50);
      
      if (pendingOrders.length === 0) {
        return;
      }

      logger.debug(`Found ${pendingOrders.length} pending orders to verify`);

      for (const order of pendingOrders) {
        await this.verifyOrder(order);
      }
    } catch (error) {
      logger.error('Error in verifyPendingOrders:', error);
    }
  }

  async verifyOrder(order) {
    try {
      // 如果没有交易哈希，跳过
      if (!order.tx_hash) {
        logger.debug(`Order ${order.order_no} has no tx_hash yet`);
        return;
      }

      logger.info(`Verifying order ${order.order_no}, tx: ${order.tx_hash}`);

      // 获取交易收据
      const receipt = await this.provider.getTransactionReceipt(order.tx_hash);

      if (!receipt) {
        // 交易可能还未上链
        logger.debug(`Transaction ${order.tx_hash} not found yet`);
        return;
      }

      // 检查交易状态
      if (receipt.status === 0) {
        logger.warn(`Transaction ${order.tx_hash} failed`);
        await RechargeOrder.fail(order.order_no, '交易执行失败');
        return;
      }

      // 检查确认数
      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      if (confirmations < this.config.confirmationBlocks) {
        logger.debug(`Transaction ${order.tx_hash} has ${confirmations} confirmations, need ${this.config.confirmationBlocks}`);
        return;
      }

      // 验证交易详情
      const validationResult = await this.validateTransaction(order, receipt);

      if (!validationResult.valid) {
        logger.warn(`Order ${order.order_no} validation failed: ${validationResult.reason}`);
        await RechargeOrder.fail(order.order_no, validationResult.reason);
        return;
      }

      // 处理订单
      const result = await RechargeOrder.processOrder(order.order_no, order.tx_hash, order.token_amount);

      logger.info(`Order ${order.order_no} processed successfully, chips added: ${result.chipsAdded}`);

    } catch (error) {
      logger.error(`Error verifying order ${order.order_no}:`, error);
    }
  }

  async validateTransaction(order, receipt) {
    try {
      // 验证 from 地址
      const tx = await this.provider.getTransaction(order.tx_hash);
      
      if (!tx) {
        return { valid: false, reason: '无法获取交易详情' };
      }

      if (tx.from.toLowerCase() !== order.wallet_address.toLowerCase()) {
        return { valid: false, reason: '发送地址不匹配' };
      }

      // 获取代币合约地址
      const tokenAddress = order.token_symbol === 'USDT' 
        ? this.config.usdtAddress 
        : this.config.usdcAddress;

      // 解析 Transfer 事件
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === tokenAddress.toLowerCase()) {
          try {
            const parsedLog = contract.interface.parseLog({
              topics: log.topics,
              data: log.data
            });

            if (parsedLog && parsedLog.name === 'Transfer') {
              const to = parsedLog.args[1];
              const value = parsedLog.args[2];

              // 验证 to 地址
              if (to.toLowerCase() !== this.config.walletAddress.toLowerCase()) {
                continue;
              }

              // 验证金额 (考虑精度)
              const decimals = 6; // USDT/USDC 都是 6 位小数
              const transferredAmount = parseFloat(ethers.formatUnits(value, decimals));

              // 允许小额误差
              const expectedAmount = parseFloat(order.token_amount);
              const tolerance = 0.000001;

              if (Math.abs(transferredAmount - expectedAmount) > tolerance) {
                return { 
                  valid: false, 
                  reason: `金额不匹配: 期望 ${expectedAmount}, 实际 ${transferredAmount}` 
                };
              }

              return { valid: true };
            }
          } catch (e) {
            // 不是 Transfer 事件，继续
          }
        }
      }

      return { valid: false, reason: '未找到对应的转账记录' };

    } catch (error) {
      logger.error('Error validating transaction:', error);
      return { valid: false, reason: '验证交易时发生错误' };
    }
  }

  // 手动验证某个订单
  async manualVerify(orderNo) {
    const order = await RechargeOrder.findByOrderNo(orderNo);
    if (!order) {
      throw new Error('订单不存在');
    }

    await this.verifyOrder(order);
    return await RechargeOrder.findByOrderNo(orderNo);
  }
}

// 单例
const orderVerifier = new OrderVerifier();

module.exports = orderVerifier;
