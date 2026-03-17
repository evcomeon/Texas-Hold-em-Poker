const { ethers } = require('ethers');

// 测试数据 - 来自用户的前端日志
const message = '276cafeb26d3ff24d93519405432da922dd8183e9136a958586300991780df68';
const signature = '0xafa914d34fe66cd9bb94aec641cebd11ec7484441e34fd41138726185a83d3e751f947ac7826b9cd9f8ee6f090ef9a36fe147d9391dc6c299ffb44e413d830061c';
const expectedAddress = '0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3';

console.log('Testing ethers v6 verifyMessage...');
console.log('Message:', message);
console.log('Signature:', signature);
console.log('Expected address:', expectedAddress);

try {
  const recovered = ethers.verifyMessage(message, signature);
  console.log('Recovered address:', recovered);
  console.log('Match:', recovered.toLowerCase() === expectedAddress.toLowerCase());
} catch (e) {
  console.error('Error:', e.message);
}

// 测试 hashMessage + recoverAddress
console.log('\nTesting hashMessage + recoverAddress...');
try {
  const hash = ethers.hashMessage(message);
  console.log('Message hash:', hash);
  const recovered2 = ethers.recoverAddress(hash, signature);
  console.log('Recovered address:', recovered2);
} catch (e) {
  console.error('Error:', e.message);
}

// 测试使用 SigningKey
console.log('\nTesting with splitSignature + recoverAddress...');
try {
  const hash = ethers.hashMessage(message);
  const sig = ethers.splitSignature(signature);
  console.log('r:', sig.r);
  console.log('s:', sig.s);
  console.log('v:', sig.v);
  const recovered3 = ethers.recoverAddress(hash, sig);
  console.log('Recovered address:', recovered3);
} catch (e) {
  console.error('Error:', e.message);
}
