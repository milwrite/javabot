#!/usr/bin/env node

// Script to update all existing HTML pages with favicon from site-config.js
const fs = require('fs').promises;
const path = require('path');
const SITE_CONFIG = require('../site-config.js');

async function updateFaviconInFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        
        // Skip if favicon already exists
        if (content.includes('<link rel="icon"')) {
            console.log(`⏭️  Skipped ${path.basename(filePath)} - favicon already exists`);
            return false;
        }
        
        // Add favicon after title tag
        const faviconHTML = `    ${SITE_CONFIG.getFaviconHTML(true)}`;
        
        // Find title tag and add favicon after it
        if (content.includes('</title>')) {
            const updatedContent = content.replace(
                '</title>',
                `</title>\n${faviconHTML}`
            );
            
            await fs.writeFile(filePath, updatedContent, 'utf8');
            console.log(`✅ Updated ${path.basename(filePath)} with favicon`);
            return true;
        } else {
            console.log(`⚠️  Skipped ${path.basename(filePath)} - no title tag found`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error updating ${path.basename(filePath)}:`, error.message);
        return false;
    }
}

async function updateAllPages() {
    console.log('🚀 Updating all HTML pages with dynamic favicon...\n');
    
    const srcDir = path.join(__dirname, '..', 'src');
    
    try {
        const files = await fs.readdir(srcDir);
        const htmlFiles = files.filter(file => file.endsWith('.html'));
        
        console.log(`📁 Found ${htmlFiles.length} HTML files in /src/\n`);
        
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        
        for (const file of htmlFiles) {
            const filePath = path.join(srcDir, file);
            const result = await updateFaviconInFile(filePath);
            
            if (result === true) updated++;
            else if (result === false) skipped++;
            else errors++;
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`   ✅ Updated: ${updated} files`);
        console.log(`   ⏭️  Skipped: ${skipped} files`);
        console.log(`   ❌ Errors: ${errors} files`);
        
        console.log(`\n🎯 Favicon configuration:`);
        console.log(`   📁 Source: ${SITE_CONFIG.favicon.href}`);
        console.log(`   🔗 Path for subdirectories: ${SITE_CONFIG.favicon.getPath(true)}`);
        console.log(`   📄 Generated HTML: ${SITE_CONFIG.getFaviconHTML(true)}`);
        
    } catch (error) {
        console.error('❌ Error reading src directory:', error.message);
    }
}

// Run if called directly
if (require.main === module) {
    updateAllPages();
}

module.exports = { updateAllPages, updateFaviconInFile };