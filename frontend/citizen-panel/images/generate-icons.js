/**
 * Icon Generation Script for VoiceUp PWA
 * 
 * This script generates PNG icons from the SVG base icon.
 * Run with: node generate-icons.js
 * 
 * Prerequisites:
 *   npm install sharp
 * 
 * Or use an online SVG to PNG converter with icon-base.svg
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
try {
    const sharp = require('sharp');
    
    const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
    const svgPath = path.join(__dirname, 'icon-base.svg');
    
    async function generateIcons() {
        for (const size of sizes) {
            const outputPath = path.join(__dirname, `icon-${size}x${size}.png`);
            await sharp(svgPath)
                .resize(size, size)
                .png()
                .toFile(outputPath);
            console.log(`Generated: icon-${size}x${size}.png`);
        }
        console.log('All icons generated successfully!');
    }
    
    generateIcons().catch(console.error);
    
} catch (e) {
    console.log('Sharp not installed. To generate PNG icons:');
    console.log('1. Run: npm install sharp');
    console.log('2. Then run: node generate-icons.js');
    console.log('');
    console.log('Alternatively, use an online SVG to PNG converter with icon-base.svg');
    console.log('and save the outputs as icon-192x192.png and icon-512x512.png');
}
