const { ethers } = require('ethers');

// 最新测试数据
const message = 'e24b9cadf8ce4f29a08c236db6bcb7d9e2ff6f24911fd276ef75a0ec0b653a58';
const signature = '0xd7838024267e4fb3d4858591118dd0ab2950fa4d6f43fc04cad3e9e2e4811625692ef9846a92c742fe5c68e405b383d275e3cd16b731e92e3d4edba4dd33050f1c';
const expectedAddress = '0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3';

console.log('=== Testing Signature Verification ===');
console.log('Message:', message);
console.log('Signature:', signature);
console.log('Expected address:', expectedAddress);
console.log('Signature length:', signature.length);

// 检查签名格式
console.log('\n=== Signature Analysis ===');
const sigWithoutPrefix = signature.startsWith('0x') ? signature.slice(2) : signature;
console.log('Signature without 0x:', sigWithoutPrefix);
console.log('Length without 0x:', sigWithoutPrefix.length);

// r, s, v 分解
const r = '0x' + sigWithoutPrefix.slice(0, 64);
const s = '0x' + sigWithoutPrefix.slice(64, 128);
const v = parseInt(sigWithoutPrefix.slice(128, 130), 16);
console.log('r:', r);
console.log('s:', s);
console.log('v:', v);

// 使用 ethers 验证
console.log('\n=== ethers.verifyMessage ===');
try {
  const recovered = ethers.verifyMessage(message, signature);
  console.log('Recovered:', recovered);
} catch (e) {
  console.error('Error:', e.message);
}

// 手动计算
console.log('\n=== Manual Recovery ===');
try {
  const hash = ethers.hashMessage(message);
  console.log('Message hash:', hash);
  
  // 使用 Signature 类
  const sig = ethers.Signature.from(signature);
  console.log('Parsed signature:');
  console.log('  r:', sig.r);
  console.log('  s:', sig.s);
  console.log('  v (yParity):', sig.yParity);
  
  const recovered = ethers.recoverAddress(hash, sig);
  console.log('Recovered address:', recovered);
} catch (e) {
  console.error('Error:', e.message);
}

// 测试不同的 v 值
console.log('\n=== Testing with different v values ===');
for (let yParity = 0; yParity <= 1; yParity++) {
  try {
    const sig = ethers.Signature.from({
      r: r,
      s: s,
      yParity: yParity
    });
    const hash = ethers.hashMessage(message);
    const recovered = ethers.recoverAddress(hash, sig);
    console.log(`yParity=${yParity}: ${recovered}`);
  } catch (e) {
    console.error(`yParity=${yParity}: Error - ${e.message}`);
  }
}
