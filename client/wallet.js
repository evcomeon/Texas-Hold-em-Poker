// ============================================================
// Web3 Wallet Connector - 多钱包连接模块
// ============================================================

class WalletConnector {
  constructor() {
    this.providers = [];
    this.currentProvider = null;
    this.currentAccount = null;
    this.listeners = new Map();
  }

  // 检测所有可用的钱包
  detectWallets() {
    const wallets = [];
    const ethereum = window.ethereum;
    
    if (!ethereum) {
      // 返回推荐的未安装钱包
      return this.getRecommendedWallets();
    }
    
    // 检查是否有多个 providers
    const providers = ethereum.providers || [ethereum];
    
    // 遍历所有 providers
    providers.forEach((provider, index) => {
      // MetaMask
      if (provider.isMetaMask && !provider.isBraveWallet) {
        wallets.push({
          name: 'MetaMask',
          icon: '🦊',
          type: 'injected',
          provider: provider,
          installed: true,
          url: 'https://metamask.io/download/'
        });
      }
      
      // Coinbase Wallet
      if (provider.isCoinbaseWallet) {
        wallets.push({
          name: 'Coinbase Wallet',
          icon: '🔵',
          type: 'injected',
          provider: provider,
          installed: true,
          url: 'https://www.coinbase.com/wallet'
        });
      }
      
      // Brave Wallet
      if (provider.isBraveWallet) {
        wallets.push({
          name: 'Brave Wallet',
          icon: '🦁',
          type: 'injected',
          provider: provider,
          installed: true,
          url: 'https://brave.com/wallet/'
        });
      }
      
      // Trust Wallet
      if (provider.isTrust) {
        wallets.push({
          name: 'Trust Wallet',
          icon: '🛡️',
          type: 'injected',
          provider: provider,
          installed: true,
          url: 'https://trustwallet.com/'
        });
      }
      
      // Rabby Wallet
      if (provider.isRabby) {
        wallets.push({
          name: 'Rabby',
          icon: '🐰',
          type: 'injected',
          provider: provider,
          installed: true,
          url: 'https://rabby.io/'
        });
      }
    });
    
    // 如果没有检测到特定钱包，但有 ethereum，则添加为通用钱包
    if (wallets.length === 0 && ethereum) {
      wallets.push({
        name: 'Web3 钱包',
        icon: '🔐',
        type: 'injected',
        provider: ethereum,
        installed: true,
        url: ''
      });
    }
    
    // 添加推荐的未安装钱包
    const recommended = this.getRecommendedWallets();
    recommended.forEach(rw => {
      if (!wallets.find(w => w.name === rw.name)) {
        wallets.push(rw);
      }
    });
    
    return wallets;
  }
  
  getRecommendedWallets() {
    return [
      { name: 'MetaMask', icon: '🦊', type: 'injected', installed: false, url: 'https://metamask.io/download/' },
      { name: 'Coinbase Wallet', icon: '🔵', type: 'injected', installed: false, url: 'https://www.coinbase.com/wallet' },
      { name: 'Trust Wallet', icon: '🛡️', type: 'injected', installed: false, url: 'https://trustwallet.com/browser-extension/' }
    ];
  }

  // 检查是否有任何钱包可用
  hasWallet() {
    return !!(window.ethereum);
  }

  // 连接钱包
  async connect(walletName = null) {
    console.log('[WalletConnector] connect called, walletName:', walletName);
    const wallets = this.detectWallets();
    const installedWallets = wallets.filter(w => w.installed);
    console.log('[WalletConnector] detected wallets:', wallets);
    console.log('[WalletConnector] installed wallets:', installedWallets);
    
    if (installedWallets.length === 0) {
      throw new Error('NO_WALLET');
    }
    
    // 选择钱包
    let targetWallet;
    if (walletName) {
      targetWallet = installedWallets.find(w => w.name === walletName);
      if (!targetWallet) {
        throw new Error(`钱包 ${walletName} 未安装`);
      }
    } else {
      // 默认使用第一个已安装的钱包
      targetWallet = installedWallets[0];
    }
    
    console.log('[WalletConnector] selected wallet:', targetWallet);
    this.currentProvider = targetWallet.provider;
    console.log('[WalletConnector] set currentProvider:', this.currentProvider ? 'exists' : 'null');
    
    try {
      // 请求连接
      const accounts = await this.currentProvider.request({ 
        method: 'eth_requestAccounts' 
      });
      
      console.log('[WalletConnector] accounts:', accounts);
      
      if (accounts.length === 0) {
        throw new Error('用户拒绝连接');
      }
      
      this.currentAccount = accounts[0];
      console.log('[WalletConnector] set currentAccount:', this.currentAccount);
      
      // 监听账户变化
      this.currentProvider.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          this.emit('disconnect');
        } else {
          this.currentAccount = accounts[0];
          this.emit('accountsChanged', accounts[0]);
        }
      });
      
      // 监听链变化
      this.currentProvider.on('chainChanged', (chainId) => {
        this.emit('chainChanged', chainId);
      });
      
      this.emit('connect', {
        address: this.currentAccount,
        wallet: targetWallet.name
      });
      
      return {
        address: this.currentAccount,
        wallet: targetWallet.name
      };
      
    } catch (error) {
      console.error('[WalletConnector] connect error:', error);
      if (error.code === 4001) {
        throw new Error('用户拒绝连接');
      }
      throw error;
    }
  }

  // 签名消息
  async signMessage(message) {
    console.log('[WalletConnector] signMessage called');
    console.log('[WalletConnector] currentProvider:', this.currentProvider ? 'exists' : 'null');
    console.log('[WalletConnector] currentAccount:', this.currentAccount);
    console.log('[WalletConnector] message:', message);
    
    // 检查 provider 的 isMetaMask 属性
    if (this.currentProvider) {
      console.log('[WalletConnector] provider.isMetaMask:', this.currentProvider.isMetaMask);
      console.log('[WalletConnector] provider.isBraveWallet:', this.currentProvider.isBraveWallet);
    }
    
    if (!this.currentProvider || !this.currentAccount) {
      throw new Error('请先连接钱包');
    }
    
    try {
      // 直接使用 window.ethereum 而不是保存的 provider
      // 因为某些钱包扩展会覆盖 window.ethereum
      const provider = window.ethereum;
      console.log('[WalletConnector] Using window.ethereum');
      console.log('[WalletConnector] window.ethereum.isMetaMask:', provider?.isMetaMask);
      
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, this.currentAccount]
      });
      
      console.log('[WalletConnector] signature result:', signature);
      return signature;
    } catch (error) {
      console.error('[WalletConnector] signMessage error:', error);
      if (error.code === 4001) {
        throw new Error('用户拒绝签名');
      }
      throw error;
    }
  }

  // 获取当前网络
  async getChainId() {
    if (!this.currentProvider) {
      throw new Error('请先连接钱包');
    }
    
    const chainId = await this.currentProvider.request({ 
      method: 'eth_chainId' 
    });
    
    return parseInt(chainId, 16);
  }

  // 切换网络
  async switchChain(chainId) {
    if (!this.currentProvider) {
      throw new Error('请先连接钱包');
    }
    
    try {
      await this.currentProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }]
      });
    } catch (error) {
      if (error.code === 4902) {
        throw new Error('请添加该网络到钱包');
      }
      throw error;
    }
  }

  // 发送交易
  async sendTransaction(tx) {
    if (!this.currentProvider || !this.currentAccount) {
      throw new Error('请先连接钱包');
    }
    
    const txHash = await this.currentProvider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: this.currentAccount,
        ...tx
      }]
    });
    
    return txHash;
  }

  // 事件监听
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => callback(data));
    }
  }

  // 断开连接
  disconnect() {
    this.currentProvider = null;
    this.currentAccount = null;
    this.emit('disconnect');
  }
}

// 创建全局实例
const walletConnector = new WalletConnector();

// 挂载到 window 对象
window.WalletConnector = WalletConnector;
window.walletConnector = walletConnector;

export { WalletConnector, walletConnector };
