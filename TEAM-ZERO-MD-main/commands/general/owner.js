/**
 * Owner Command - Fixed for RANA USMAN (TEAM ZERO-MD)
 */

const config = require('../../config');

module.exports = {
    name: 'owner',
    aliases: ['creator', 'dev', 'botowner'],
    category: 'general',
    description: 'Show bot owner contact information',
    usage: '.owner',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;

            // Aapka fixed data
            const myNumber = "923114063519"; 
            const myName = "RANA USMAN";

            // vCard format
            const vCards = [{
                vcard: `
BEGIN:VCARD
VERSION:3.0
FN:${myName}
TEL;waid=${myNumber}:${myNumber}
END:VCARD
                `.trim()
            }];

            // Pehle contact card bhejne ke liye
            await sock.sendMessage(chatId, {
                contacts: {
                    displayName: myName,
                    contacts: vCards
                }
            });

            // Aapka stylish format (Bold styling ke sath)
            const ownerMsg = `👑 *『 𝙊𝙒𝙉𝙀𝙍 𝙄𝙉𝙁𝙊 』*

╭━━━〔 👤 𝙊𝙒𝙉𝙀𝙍 〕━━━⬣
┃ 🫠 𝙉𝘼𝙈𝙀 : *${myName}*
┃ 📱 𝙉𝙐𝙈𝘽𝙀𝙍 : *${myNumber}*
╰━━━━━━━━━━━━━━⬣

🔥 *𝘾𝙊𝙉𝙏𝘼𝘾𝙏 𝙈𝙀* 💀

> *𝙋𝙊𝙒𝙀𝙍𝙀𝘿 𝘽𝙔* ***TEAM ZERO-MD***`;

            await extra.reply(ownerMsg);

        } catch (error) {
            console.error('Owner command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
