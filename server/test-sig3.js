const { ethers } = require('ethers');

// 测试数据
const nonce = 'e24b9cadf8ce4f29a08c236db6bcb7d9e2ff6f24911fd276ef75a0ec0b653a58';
const signature = '0xd7838024267e4fb3d4858591118dd0ab2950fa4d6f43fc04cad3e9e2e4811625692ef9846a92c742fe5c68e405b383d275e3cd16b731e92e3d4edba4dd33050f1c';
const expectedAddress = '0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3';

console.log('=== Testing different message formats ===\n');

// 1. 作为普通字符串
console.log('1. As plain string (no 0x prefix):');
console.log('   Message:', nonce);
const hash1 = ethers.hashMessage(nonce);
console.log('   Hash:', hash1);
try {
  const recovered1 = ethers.verifyMessage(nonce, signature);
  console.log('   Recovered:', recovered1);
} catch (e) {
  console.error('   Error:', e.message);
}

// 2. 作为 hex 字符串 (加 0x 前缀)
console.log('\n2. As hex string (with 0x prefix):');
const nonceHex = '0x' + nonce;
console.log('   Message:', nonceHex);
const hash2 = ethers.hashMessage(nonceHex);
console.log('   Hash:', hash2);
try {
  const recovered2 = ethers.verifyMessage(nonceHex, signature);
  console.log('   Recovered:', recovered2);
} catch (e) {
  console.error('   Error:', e.message);
}

// 3. 作为字节数组
console.log('\n3. As bytes array:');
const nonceBytes = ethers.getBytes(nonceHex);
console.log('   Bytes length:', nonceBytes.length);
const hash3 = ethers.hashMessage(nonceBytes);
console.log('   Hash:', hash3);
try {
  const recovered3 = ethers.verifyMessage(nonceBytes, signature);
  console.log('   Recovered:', recovered3);
} catch (e) {
  console.error('   Error:', e.message);
}

// 4. 手动构建 signed message
console.log('\n4. Manual signed message construction:');
const messageLength = nonce.length; // 字符串长度
const signedMessage = '\x19Ethereum Signed Message:\n' + messageLength + nonce;
console.log('   Signed message prefix:', JSON.stringify(signedMessage.slice(0, 30)));
console.log('   Message length:', messageLength);
const manualHash = ethers.keccak256(ethers.toUtf8Bytes(signedMessage));
console.log('   Manual hash:', manualHash);

// 用手动 hash 恢复地址
try {
  const recovered4 = ethers.recoverAddress(manualHash, signature);
  console.log('   Recovered:', recovered4);
  console.log('   Match expected?', recovered4.toLowerCase() === expectedAddress.toLowerCase());
} catch (e) {
  console.error('   Error:', e.message);
}

// 5. 检查 hash1 和 manualHash 是否一致
console.log('\n5. Comparing hashes:');
console.log('   hashMessage(string):', hash1);
console.log('   Manual hash:', manualHash);
console.log('   Equal?', hash1 === manualHash);
