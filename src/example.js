// Example Phaser 3 Game - Catch the Falling Objects
// This is a reference implementation showing proper Phaser 3 structure

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

let player;
let cursors;
let score = 0;
let scoreText;
let fallingObjects;
let gameOver = false;

function preload() {
    // No assets needed - using simple shapes
}

function create() {
    // Create player (rectangle)
    player = this.add.rectangle(400, 550, 60, 20, 0x00AE86);
    this.physics.add.existing(player);
    player.body.setCollideWorldBounds(true);
    player.body.setImmovable(true);

    // Create cursor keys for input
    cursors = this.input.keyboard.createCursorKeys();

    // Score text
    scoreText = this.add.text(16, 16, 'Score: 0', {
        fontSize: '32px',
        fill: '#fff'
    });

    // Group for falling objects
    fallingObjects = this.physics.add.group();

    // Spawn falling objects every 1 second
    this.time.addEvent({
        delay: 1000,
        callback: spawnObject,
        callbackScope: this,
        loop: true
    });

    // Collision detection
    this.physics.add.overlap(player, fallingObjects, catchObject, null, this);
}

function update() {
    if (gameOver) {
        return;
    }

    // Player movement
    if (cursors.left.isDown) {
        player.x -= 5;
    } else if (cursors.right.isDown) {
        player.x += 5;
    }

    // Keep player in bounds
    if (player.x < 30) player.x = 30;
    if (player.x > 770) player.x = 770;

    // Remove objects that fall off screen
    fallingObjects.children.entries.forEach(obj => {
        if (obj.y > 600) {
            obj.destroy();
        }
    });
}

function spawnObject() {
    const x = Phaser.Math.Between(50, 750);
    const obj = this.add.circle(x, 0, 15, 0xff6b6b);
    this.physics.add.existing(obj);
    obj.body.setVelocity(0, 200);
    fallingObjects.add(obj);
}

function catchObject(player, obj) {
    obj.destroy();
    score += 10;
    scoreText.setText('Score: ' + score);
}
