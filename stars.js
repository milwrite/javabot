// Stars background generator for Bot Sportello Arcade
// Auto-creates twinkling starry sky effect
(function() {
    // Create stars container if it doesn't exist
    let starsContainer = document.getElementById('stars');
    if (!starsContainer) {
        starsContainer = document.createElement('div');
        starsContainer.id = 'stars';
        starsContainer.className = 'stars';
        document.body.insertBefore(starsContainer, document.body.firstChild);
    }

    const colors = ['', 'blue', 'cyan', 'red'];

    for (let i = 0; i < 150; i++) {
        const star = document.createElement('div');
        star.className = 'star';

        // Random color (mostly white, some colored)
        if (Math.random() > 0.7) {
            const colorClass = colors[Math.floor(Math.random() * colors.length)];
            if (colorClass) star.classList.add(colorClass);
        }

        // Random size (1-3px)
        const size = Math.random() * 2 + 1;
        star.style.width = size + 'px';
        star.style.height = size + 'px';

        // Random position
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';

        // Random animation delay for staggered twinkling
        star.style.animationDelay = Math.random() * 3 + 's';
        star.style.animationDuration = (Math.random() * 2 + 2) + 's';

        starsContainer.appendChild(star);
    }
})();
