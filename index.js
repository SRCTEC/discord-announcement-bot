require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();

// Create database connection
const db = new sqlite3.Database('bot.db');

// Initialize database tables
db.serialize(() => {
    // Table for scheduled announcements
    db.run(`CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        message TEXT NOT NULL,
        cron_schedule TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
    )`);

    // Table for reminders
    db.run(`CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        reminder_time DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_completed INTEGER DEFAULT 0
    )`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers
    ]
});

// Command collection
client.commands = new Collection();

// Load commands
const commands = ['announcement', 'reminder'];
for (const command of commands) {
    const commandFile = require(`./src/${command}.js`);
    client.commands.set(commandFile.data.name, commandFile);
}

// Initialize active announcements
function initializeAnnouncements() {
    db.all('SELECT * FROM announcements WHERE is_active = 1', (err, rows) => {
        if (err) {
            console.error('Error loading announcements:', err);
            return;
        }

        rows.forEach(announcement => {
            scheduleAnnouncement(announcement);
        });

        console.log(`Loaded ${rows.length} active announcements`);
    });
}

// Schedule an announcement
function scheduleAnnouncement(announcement) {
    cron.schedule(announcement.cron_schedule, async () => {
        try {
            const channel = await client.channels.fetch(announcement.channel_id);
            if (channel) {
                await channel.send(announcement.message);
            }
        } catch (error) {
            console.error(`Error sending announcement ${announcement.id}:`, error);
        }
    });
}

// Check for due reminders every minute
setInterval(() => {
    const now = new Date();
    db.all(
        'SELECT * FROM reminders WHERE is_completed = 0 AND reminder_time <= ?',
        [now.toISOString()],
        async (err, rows) => {
            if (err) {
                console.error('Error checking reminders:', err);
                return;
            }

            for (const reminder of rows) {
                try {
                    const user = await client.users.fetch(reminder.user_id);
                    await user.send(`Reminder: ${reminder.message}`);
                    
                    // Mark reminder as completed
                    db.run('UPDATE reminders SET is_completed = 1 WHERE id = ?', [reminder.id]);
                } catch (error) {
                    console.error(`Error sending reminder ${reminder.id}:`, error);
                }
            }
        }
    );
}, 60000); // Check every minute

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    initializeAnnouncements();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({
            content: 'There was an error executing this command!',
            ephemeral: true
        });
    }
});

client.login(process.env.DISCORD_TOKEN); 