document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');

    const data = {
        nodes: [
            // Collections
            { id: 'coll_featured', name: '🎯 Featured', type: 'collection' },
            { id: 'coll_meta', name: '🔧 Meta', type: 'collection' },
            { id: 'coll_arcade-games', name: '🕹️ Arcade Games', type: 'collection' },
            { id: 'coll_utilities-apps', name: '📋 Utilities & Apps', type: 'collection' },
            { id: 'coll_stories-content', name: '📖 Stories & Content', type: 'collection' },
            { id: 'coll_unsorted', name: '🗂️ Unsorted', type: 'collection' },

            // Commits
            { id: 'b604b90', name: 'b604b90: replace personality framing...', type: 'commit', date: '01-03 05:44' },
            { id: '82c1aa3', name: '82c1aa3: add action-oriented personality...', type: 'commit', date: '01-03 05:44' },
            { id: 'd8a2e27', name: 'd8a2e27: add story template, routing...', type: 'commit', date: '01-03 05:44' },
            { id: 'dad180f', name: 'dad180f: fix: add missing columns to schema', type: 'commit', date: '01-03 05:44' },
            { id: 'a511c2c', name: 'a511c2c: devlog: document identity-first assembly', type: 'commit', date: '01-03 05:44' },
            { id: 'e71e993', name: 'e71e993: add noir simon', type: 'commit', date: '12-26 00:48' },
            { id: '2d19bd2', name: '2d19bd2: add deep research...', type: 'commit', date: '12-26 00:48' },
            { id: '95dbdf1', name: '95dbdf1: fix: prevent template placeholder URLs', type: 'commit', date: '12-26 00:48' },
            { id: '09733ab', name: '09733ab: fix: add context to postgresql logging', type: 'commit', date: '12-26 00:48' },
            { id: 'b501200', name: 'b501200: fix: sequence recall colors', type: 'commit', date: '12-26 00:48' },
            { id: '3a4755c', name: '3a4755c: change sequence recall buttons', type: 'commit', date: '12-26 00:48' },
            { id: '468e8ba', name: '468e8ba: fix: add debug/isn\'t working to routing', type: 'commit', date: '12-26 00:48' },
            { id: '8920425', name: '8920425: fix: skip read-only cap for edit/create', type: 'commit', date: '12-26 00:48' },
            { id: 'afcb12c', name: 'afcb12c: fix: connect action cache to llm router', type: 'commit', date: '12-26 00:48' },
            { id: '6dea405', name: '6dea405: add winter for pia', type: 'commit', date: '12-26 00:48' },
        ],
        edges: [
            // Chronological links
            { source: 'b604b90', target: '82c1aa3' },
            { source: '82c1aa3', target: 'd8a2e27' },
            { source: 'd8a2e27', target: 'dad180f' },
            { source: 'dad180f', target: 'a511c2c' },
            { source: 'a511c2c', target: 'e71e993' }, // Time gap
            { source: 'e71e993', target: '2d19bd2' },
            { source: '2d19bd2', target: '95dbdf1' },
            { source: '95dbdf1', target: '09733ab' },
            { source: '09733ab', target: 'b501200' },
            { source: 'b501200', target: '3a4755c' },
            { source: '3a4755c', target: '468e8ba' },
            { source: '468e8ba', target: '8920425' },
            { source: '8920425', target: 'afcb12c' },
            { source: 'afcb12c', target: '6dea405' },

            // Commit to Collection links (commentary on classification)
            { source: 'b604b90', target: 'coll_meta' },
            { source: '82c1aa3', target: 'coll_meta' },
            { source: 'd8a2e27', target: 'coll_stories-content' },
            { source: 'd8a2e27', target: 'coll_meta' },
            { source: 'dad180f', target: 'coll_meta' },
            { source: 'a511c2c', target: 'coll_meta' },
            { source: 'e71e993', target: 'coll_arcade-games' },
            { source: '2d19bd2', target: 'coll_featured' },
            { source: 'b501200', target: 'coll_arcade-games' },
            { source: '3a4755c', target: 'coll_arcade-games' },
            { source: '6dea405', target: 'coll_stories-content' },
            { source: 'afcb12c', target: 'coll_meta' },
        ]
    };

    const nodes = data.nodes;
    const edges = data.edges;

    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startX, startY;

    canvas.onmousedown = (e) => {
        isPanning = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        canvas.style.cursor = 'grabbing';
    };

    canvas.onmouseup = () => {
        isPanning = false;
        canvas.style.cursor = 'move';
    };

    canvas.onmouseleave = () => {
        isPanning = false;
        canvas.style.cursor = 'move';
    };

    canvas.onmousemove = (e) => {
        if (isPanning) {
            panX = e.clientX - startX;
            panY = e.clientY - startY;
            updateTransform();
        }
    };

    canvas.onwheel = (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const scaleAmount = 1 - e.deltaY * 0.001;

        panX = mouseX - (mouseX - panX) * scaleAmount;
        panY = mouseY - (mouseY - panY) * scaleAmount;
        scale *= scaleAmount;

        updateTransform();
    };

    // Touch event handlers for mobile
    let lastTouchDistance = 0;
    let isTouchPanning = false;
    let touchStartX, touchStartY;

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            // Single touch - panning
            isTouchPanning = true;
            touchStartX = e.touches[0].clientX - panX;
            touchStartY = e.touches[0].clientY - panY;
        } else if (e.touches.length === 2) {
            // Two fingers - pinch to zoom
            isTouchPanning = false;
            lastTouchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && isTouchPanning) {
            // Single touch panning
            panX = e.touches[0].clientX - touchStartX;
            panY = e.touches[0].clientY - touchStartY;
            updateTransform();
        } else if (e.touches.length === 2) {
            // Pinch to zoom
            const currentDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );

            if (lastTouchDistance > 0) {
                const scaleAmount = currentDistance / lastTouchDistance;

                // Calculate pinch center
                const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

                panX = centerX - (centerX - panX) * scaleAmount;
                panY = centerY - (centerY - panY) * scaleAmount;
                scale *= scaleAmount;

                updateTransform();
            }
            lastTouchDistance = currentDistance;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        isTouchPanning = false;
        lastTouchDistance = 0;
    }, { passive: true });

    // Clear active labels when tapping empty canvas
    canvas.addEventListener('click', (e) => {
        if (e.target === canvas) {
            document.querySelectorAll('.node.active').forEach(n => n.classList.remove('active'));
        }
    });

    function updateTransform() {
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    }

    const nodeElements = {};
    const lineElements = {};

    function render() {
        nodes.forEach(node => {
            const el = document.createElement('div');
            el.className = 'node';
            el.dataset.id = node.id;
            el.style.backgroundColor = {
                'collection': '#00f',
                'commit': '#ff0'
            }[node.type] || '#333';

            const label = document.createElement('div');
            label.className = 'label';
            label.textContent = node.name;
            el.appendChild(label);

            // Tap to toggle label on mobile
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                // Clear other active nodes
                document.querySelectorAll('.node.active').forEach(n => {
                    if (n !== el) n.classList.remove('active');
                });
                el.classList.toggle('active');
            });

            canvas.appendChild(el);
            nodeElements[node.id] = el;

            if (!node.x) {
                node.x = Math.random() * window.innerWidth;
                node.y = Math.random() * window.innerHeight;
            }
        });

        edges.forEach((edge, i) => {
            const el = document.createElement('div');
            el.className = 'line';
            canvas.appendChild(el);
            lineElements[i] = el;
        });

        updatePositions();
    }

    function updatePositions() {
        nodes.forEach(node => {
            const el = nodeElements[node.id];
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
        });

        edges.forEach((edge, i) => {
            const sourceNode = nodes.find(n => n.id === edge.source);
            const targetNode = nodes.find(n => n.id === edge.target);
            if (!sourceNode || !targetNode) return;

            const el = lineElements[i];
            const x1 = sourceNode.x;
            const y1 = sourceNode.y;
            const x2 = targetNode.x;
            const y2 = targetNode.y;

            const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;

            el.style.width = `${length}px`;
            el.style.left = `${x1}px`;
            el.style.top = `${y1}px`;
            el.style.transform = `rotate(${angle}deg)`;
        });
    }

    // --- Layout Algorithms ---
    let animationFrameId;

    function stopLayout() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    }

    function forceLayout() {
        stopLayout();
        const stiffness = 0.05;
        const repulsion = 5000;
        const damping = 0.8;

        function step() {
            nodes.forEach(node => {
                if (!node.vx) node.vx = 0;
                if (!node.vy) node.vy = 0;

                let forceX = 0;
                let forceY = 0;

                // Repulsion from other nodes
                nodes.forEach(otherNode => {
                    if (node === otherNode) return;
                    const dx = node.x - otherNode.x;
                    const dy = node.y - otherNode.y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                    const repulse = repulsion / (distance * distance);
                    forceX += dx / distance * repulse;
                    forceY += dy / distance * repulse;
                });

                // Attraction from edges
                edges.forEach(edge => {
                    if (edge.source === node.id) {
                        const targetNode = nodes.find(n => n.id === edge.target);
                        const dx = targetNode.x - node.x;
                        const dy = targetNode.y - node.y;
                        forceX += dx * stiffness;
                        forceY += dy * stiffness;
                    }
                    if (edge.target === node.id) {
                        const sourceNode = nodes.find(n => n.id === edge.source);
                        const dx = sourceNode.x - node.x;
                        const dy = sourceNode.y - node.y;
                        forceX += dx * stiffness;
                        forceY += dy * stiffness;
                    }
                });
                
                // Center gravity
                const dx = window.innerWidth / 2 - node.x;
                const dy = window.innerHeight / 2 - node.y;
                forceX += dx * 0.001;
                forceY += dy * 0.001;


                node.vx = (node.vx + forceX) * damping;
                node.vy = (node.vy + forceY) * damping;

                node.x += node.vx;
                node.y += node.vy;
            });

            updatePositions();
            animationFrameId = requestAnimationFrame(step);
        }
        step();
    }

    function treeLayout() {
        stopLayout();

        const collectionNodes = nodes.filter(n => n.type === 'collection');
        const commitNodes = nodes.filter(n => n.type === 'commit');

        const hierarchy = {};
        collectionNodes.forEach(n => hierarchy[n.id] = { ...n, children: [] });

        commitNodes.forEach(commit => {
            const edge = edges.find(e => e.source === commit.id && e.target.startsWith('coll_'));
            if (edge) {
                if (hierarchy[edge.target]) {
                    hierarchy[edge.target].children.push({ ...commit });
                }
            } else {
                // Add to unsorted if no collection link
                if (hierarchy['coll_unsorted']) {
                    hierarchy['coll_unsorted'].children.push({ ...commit });
                }
            }
        });

        const collections = Object.values(hierarchy);
        const xSpacing = window.innerWidth / (collections.length + 1);

        collections.forEach((collection, i) => {
            collection.x = (i + 1) * xSpacing;
            collection.y = 100;
            
            collection.children.forEach((commit, j) => {
                const originalCommitNode = nodes.find(n => n.id === commit.id);
                originalCommitNode.x = collection.x + (j % 3 - 1) * 60;
                originalCommitNode.y = collection.y + 100 + Math.floor(j / 3) * 60;
            });
        });
        
        // Position the actual nodes
        nodes.forEach(n => {
            if (n.type === 'collection') {
                const hNode = hierarchy[n.id];
                if (hNode) {
                    n.x = hNode.x;
                    n.y = hNode.y;
                }
            }
        });


        updatePositions();
    }

    function circularLayout() {
        stopLayout();
        const radius = Math.min(window.innerWidth, window.innerHeight) / 3;
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const angleStep = (2 * Math.PI) / nodes.length;

        nodes.forEach((node, i) => {
            node.x = centerX + radius * Math.cos(i * angleStep);
            node.y = centerY + radius * Math.sin(i * angleStep);
        });
        updatePositions();
    }

    document.getElementById('force-layout').onclick = forceLayout;
    document.getElementById('tree-layout').onclick = treeLayout;
    document.getElementById('circular-layout').onclick = circularLayout;

    render();
    forceLayout();
});
