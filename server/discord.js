import { Client, GatewayIntentBits, WebhookClient } from 'discord.js';

const webhooks = {};
let client = null;

const CONFIG = {
  general: {
    channelId: process.env.DISCORD_CHANNEL_GENERAL,
    webhookUrl: process.env.DISCORD_WEBHOOK_GENERAL
  },
  aide: {
    channelId: process.env.DISCORD_CHANNEL_AIDE,
    webhookUrl: process.env.DISCORD_WEBHOOK_AIDE
  },
  ventes: {
    channelId: process.env.DISCORD_CHANNEL_VENTES,
    webhookUrl: process.env.DISCORD_WEBHOOK_VENTES
  },
  roleplay: {
    channelId: process.env.DISCORD_CHANNEL_ROLEPLAY,
    webhookUrl: process.env.DISCORD_WEBHOOK_ROLEPLAY
  }
};

export function initDiscord(game) {
  const token = process.env.DISCORD_BOT_TOKEN;

  // Initialisation des Webhooks pour chaque canal configuré
  for (const [channel, cfg] of Object.entries(CONFIG)) {
    if (cfg.webhookUrl) {
      try {
        webhooks[channel] = new WebhookClient({ url: cfg.webhookUrl });
        console.log(`Discord Webhook initialisé pour le canal : #${channel}`);
      } catch (err) {
        console.error(`Erreur initialisation Webhook Discord (#${channel}):`, err);
      }
    }
  }

  // Collecte des IDs de salons configurés pour écouter Discord
  const channelIds = Object.values(CONFIG)
    .map(cfg => cfg.channelId)
    .filter(Boolean);

  if (token && channelIds.length > 0) {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.on('ready', () => {
      console.log(`Bot Discord connecté sous le pseudo : ${client.user.tag}`);
      console.log(`Écoute active sur ${channelIds.length} salon(s) Discord.`);
    });

    client.on('messageCreate', (message) => {
      // Ignorer les messages des bots (y compris lui-même)
      if (message.author.bot) return;

      // Retrouver le canal de jeu correspondant au message.channelId
      const gameChannel = Object.keys(CONFIG).find(
        (key) => CONFIG[key].channelId === message.channelId
      );

      if (!gameChannel) return;

      const author = message.member?.displayName || message.author.username;
      const text = message.content.trim();
      if (!text) return;

      // Diffuser le message de Discord vers le bon canal du jeu
      game.broadcastChannelChat(gameChannel, `${author} (Discord)`, text);
    });

    client.login(token).catch((err) => {
      console.error('Erreur de connexion du bot Discord:', err);
    });
  } else {
    console.log('Bot Discord non configuré ou aucun salon (DISCORD_CHANNEL_*) configuré pour l'écoute.');
  }
}

export async function sendToDiscord(channel, username, text) {
  const webhookClient = webhooks[channel];
  if (!webhookClient) return;

  try {
    await webhookClient.send({
      content: text,
      username: username,
    });
  } catch (err) {
    console.error(`Erreur envoi Webhook Discord (#${channel}):`, err);
  }
}
