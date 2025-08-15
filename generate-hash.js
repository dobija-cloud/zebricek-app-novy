const CryptoJS = require('crypto-js');
const password = '2025';
const hash = CryptoJS.MD5(password).toString(); // ZMĚNA: Používáme MD5
console.log(hash);

// SPUSTIT v terminálu:         node generate-hash.js    POTOM spustit vite: npm run dev
// mělo by se vygeberovat heslo hash pro vložení do App.jsx - NEDAŘÍ SE MI TO.
// 2. způsob: https://www.devtool.com/sha256-hash  a zde vložit platný password: 2025 - NEFUNGUJE web
//  udělal jsem zde: https://www.maxiorel.cz/md5-online-generator  
// vygeneruje se hash:  312351bff07989769097660a56395065     ale SHA-256 je bezpečnější