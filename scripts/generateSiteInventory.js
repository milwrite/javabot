const fs = require('fs').promises;

// Site Inventory System
async function generateSiteInventory() {
    try {
        console.log('[INVENTORY] Generating site inventory...');
        
        const htmlFiles = [];
        const jsFiles = [];
        const metadata = JSON.parse(await fs.readFile('../projectmetadata.json', 'utf8'));

        // Scan src directory for files
        const srcFiles = await fs.readdir('../src/');
        
        for (const file of srcFiles) {
            const filePath = `../src/${file}`;
            const stats = await fs.stat(filePath);
            
            if (stats.isFile()) {
                if (file.endsWith('.html')) {
                    // Get file info and project metadata
                    const project = metadata.projects[file.replace('.html', '')] || {};
                    htmlFiles.push({
                        name: file,
                        size: Math.round(stats.size / 1024) + 'KB',
                        created: stats.birthtime,
                        modified: stats.mtime.toISOString().split('T')[0],
                        title: project.title || file.replace('.html', '').replace(/-/g, ' '),
                        collection: project.collection || 'unsorted',
                        description: project.description || 'No description'
                    });
                } else if (file.endsWith('.js')) {
                    jsFiles.push({
                        name: file,
                        size: Math.round(stats.size / 1024) + 'KB',
                        modified: stats.mtime.toISOString().split('T')[0]
                    });
                }
            }
        }
        
        // Sort by creation date (newest first)
        htmlFiles.sort((a, b) => b.created - a.created);
        
        jsFiles.sort((a, b) => a.name.localeCompare(b.name));
        
        // Generate markdown inventory
        const inventory = `# Site Inventory

*Auto-generated on ${new Date().toISOString().split('T')[0]}*

## Overview
- **HTML Pages**: ${htmlFiles.length} files
- **JavaScript Files**: ${jsFiles.length} files  
- **Total Size**: ${Math.round((htmlFiles.reduce((sum, f) => sum + parseInt(f.size), 0) + jsFiles.reduce((sum, f) => sum + parseInt(f.size), 0)))}KB
- **Live Site**: https://bot.inference-arcade.com/

## HTML Pages by Collection

${Object.entries(metadata.collections || {}).map(([collectionName, collection]) => {
    const collectionFiles = htmlFiles.filter(f => f.collection === collectionName);
    if (collectionFiles.length === 0) return '';
    
    return `### ${collection.name || collectionName} (${collectionFiles.length} pages)
${collectionFiles.map(file => 
    `- **${file.name}** - ${file.title}
  - *${file.description}*
  - Size: ${file.size} | Modified: ${file.modified}`
).join('\n')}`;
}).filter(Boolean).join('\n\n')}

${htmlFiles.filter(f => f.collection === 'unsorted').length > 0 ? `### Unsorted Pages (${htmlFiles.filter(f => f.collection === 'unsorted').length})
${htmlFiles.filter(f => f.collection === 'unsorted').map(file => 
    `- **${file.name}** - ${file.title}
  - Size: ${file.size} | Modified: ${file.modified}`
).join('\n')}` : ''}

## JavaScript Libraries & Components

${jsFiles.map(file => 
    `- **${file.name}** - ${file.size} (${file.modified})`
).join('\n')}

## File Structure Diagram

\`\`\`
javabot/
├── src/                        # All generated content
${htmlFiles.map(f => `│   ├── ${f.name.padEnd(25)} # ${f.title}`).join('\n')}
${jsFiles.map(f => `│   ├── ${f.name.padEnd(25)} # JavaScript library`).join('\n')}
├── index.html                  # Main hub page
├── page-theme.css              # Shared noir theme  
├── projectmetadata.json        # Project metadata
└── agents.md                   # Bot conversation history
\`\`\`

## Quick Access Links

### Featured Content
${htmlFiles.filter(f => f.collection === 'featured').map(f => 
    `- [${f.title}](https://bot.inference-arcade.com/src/${f.name})`
).join('\n') || '- No featured content'}

### Games  
${htmlFiles.filter(f => f.collection === 'arcade-games').map(f => 
    `- [${f.title}](https://bot.inference-arcade.com/src/${f.name})`
).join('\n') || '- No games'}

### Utilities
${htmlFiles.filter(f => f.collection === 'utilities-apps').map(f => 
    `- [${f.title}](https://bot.inference-arcade.com/src/${f.name})`
).join('\n') || '- No utilities'}

---
*This inventory is automatically updated when DEVLOG.md changes*
`;

        await fs.writeFile('../docs/SITE_INVENTORY.md', inventory, 'utf8');
        console.log('[INVENTORY] Site inventory updated successfully');
        return inventory;
        
    } catch (error) {
        console.error('[INVENTORY] Error generating site inventory:', error);
        return `Error generating site inventory: ${error.message}`;
    }
}

module.exports = { generateSiteInventory };