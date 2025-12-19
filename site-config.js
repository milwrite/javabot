// Site-wide configuration - Single source of truth for all pages
const SITE_CONFIG = {
    // Favicon configuration
    favicon: {
        href: "default.jpg",
        type: "image/jpeg",
        // For pages in subdirectories, use relative path
        getPath: function(isSubdirectory = false) {
            return isSubdirectory ? "../" + this.href : this.href;
        }
    },
    
    // Site metadata
    site: {
        title: "Bot Sportello's Arcade",
        description: "AI-generated games and interactive content with noir terminal aesthetic",
        url: "https://bot.inference-arcade.com",
        author: "Bot Sportello"
    },
    
    // Theme configuration
    theme: {
        name: "noir-terminal",
        fontFamily: "Courier Prime",
        colors: {
            primary: "#ff0000",
            secondary: "#00ffff", 
            text: "#7ec8e3",
            background: "#0a0a0a"
        },
        cssPath: {
            main: "page-theme.css",
            getPath: function(isSubdirectory = false) {
                return isSubdirectory ? "../" + this.main : this.main;
            }
        }
    },
    
    // Navigation
    navigation: {
        homeLink: {
            text: "← HOME",
            href: "index.html",
            getPath: function(isSubdirectory = false) {
                return isSubdirectory ? "../" + this.href : this.href;
            }
        }
    },
    
    // Helper function to generate favicon HTML
    getFaviconHTML: function(isSubdirectory = false) {
        return `<link rel="icon" type="${this.favicon.type}" href="${this.favicon.getPath(isSubdirectory)}">`;
    },
    
    // Helper function to generate theme CSS link HTML  
    getThemeCSSHTML: function(isSubdirectory = false) {
        return `<link rel="stylesheet" href="${this.theme.cssPath.getPath(isSubdirectory)}">`;
    },
    
    // Helper function to generate home link HTML
    getHomeLinkHTML: function(isSubdirectory = false) {
        return `<a class="home-link" href="${this.navigation.homeLink.getPath(isSubdirectory)}">${this.navigation.homeLink.text}</a>`;
    }
};

// For Node.js environments (bot usage)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SITE_CONFIG;
}

// For browser environments (client-side usage)
if (typeof window !== 'undefined') {
    window.SITE_CONFIG = SITE_CONFIG;
}