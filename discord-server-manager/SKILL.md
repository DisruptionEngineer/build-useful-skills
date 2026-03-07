---
name: discord-server-manager
description: Manage Discord server structure via natural language or commands in any authorized channel for creating, moving, grouping, renaming, and archiving channels and categories. Use when grouping related channels into a category, creating new channels or categories, reorganizing channel order, renaming channels, archiving unused channels, listing server structure, or managing roles and permissions.
metadata: {"clawdbot":{"emoji":"🔧","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Discord Server Manager

The administrative brain for the Discord server. Accept natural language requests or explicit commands from authorized users in any allowed channel. Parse intent, map it to Discord.js API calls, and execute structural changes — creating categories, grouping channels, reordering, renaming, and archiving. Always confirm before destructive actions. Post a summary of changes to `#general` for visibility.

## When to Use

- Grouping related channels into a new category (e.g., "Group the skill channels like the 3D Printing section")
- Creating a new text or voice channel
- Creating a new category to organize channels
- Moving channels between categories
- Renaming a channel or category
- Reordering channels within a category
- Archiving unused channels (move to an Archive category and restrict access)
- Listing the full server structure (channels, categories, roles)

## Prerequisites

### Bot Permissions

The bot needs the following Discord permissions in the guild:

```
MANAGE_CHANNELS    — Create, delete, edit channels and categories
MANAGE_ROLES       — Modify channel permission overwrites
VIEW_CHANNEL       — See all channels
SEND_MESSAGES      — Post confirmations and summaries
```

```javascript
// Verify bot has required permissions
const guild = client.guilds.cache.get(GUILD_ID);
const me = guild.members.me;
const perms = me.permissions;

const required = ['ManageChannels', 'ManageRoles', 'ViewChannel', 'SendMessages'];
const missing = required.filter(p => !perms.has(p));

if (missing.length) {
  console.error(`Bot missing permissions: ${missing.join(', ')}`);
}
```

### Guild ID

```javascript
const GUILD_ID = '1439790152217002137'; // Build Useful server
```

### Authorized Users

```bash
cat ~/.agents/config/authorized-users.json
# { "authorized_users": [{ "discord_id": "1439787060763426926", "name": "disruptionengineer" }] }
```

## Commands

### `!group <channels...> as <category-name>` — Group Channels into a Category

The core command. Create a new category and move specified channels into it.

```javascript
client.on('messageCreate', async (message) => {
  if (!isAuthorizedUser(message.author.id)) return;

  const groupMatch = message.content.match(
    /^!group\s+(.+?)\s+as\s+["']?(.+?)["']?\s*$/i
  );

  if (groupMatch) {
    const [, channelList, categoryName] = groupMatch;
    const channelNames = channelList
      .split(/[,\s]+/)
      .map(c => c.replace(/^#/, '').trim().toLowerCase())
      .filter(Boolean);

    const guild = message.guild;

    // Resolve channel objects
    const resolved = [];
    const notFound = [];
    for (const name of channelNames) {
      const ch = guild.channels.cache.find(
        c => c.name.toLowerCase() === name && c.type !== 4 // not a category
      );
      if (ch) resolved.push(ch);
      else notFound.push(name);
    }

    if (notFound.length) {
      await message.reply(`⚠️ Channels not found: ${notFound.map(n => `\`${n}\``).join(', ')}`);
      if (!resolved.length) return;
    }

    // Confirm before executing
    await message.reply(
      `**🔧 Confirm: Group ${resolved.length} channels into "${categoryName}"?**\n` +
      resolved.map(c => `  • #${c.name}`).join('\n') +
      `\n\nReact ✅ to confirm or ❌ to cancel.`
    );

    const confirmation = await message.channel.awaitReactions({
      filter: (reaction, user) =>
        ['✅', '❌'].includes(reaction.emoji.name) &&
        user.id === message.author.id,
      max: 1, time: 30000
    });

    if (!confirmation.size || confirmation.first().emoji.name === '❌') {
      await message.reply('❌ Cancelled.');
      return;
    }

    // Create category
    const category = await guild.channels.create({
      name: categoryName,
      type: 4, // GuildCategory
    });

    // Move channels into the category
    for (const ch of resolved) {
      await ch.setParent(category.id, { lockPermissions: false });
    }

    await message.channel.send(
      `✅ **Created category "${categoryName}"** with ${resolved.length} channels:\n` +
      resolved.map(c => `  • #${c.name}`).join('\n')
    );
  }
});
```

```bash
# Example usage:
# !group idea-inbox, prompt-refiner, skill-factory, skill-registry, skill-digest as Skill Pipeline
```

### Natural Language Intent Parsing

Handle natural language requests like "Group the skill-factory related channels similar to 3D Printing."

```javascript
async function parseServerIntent(messageContent, guild) {
  const content = messageContent.toLowerCase();

  // Pattern: "group X channels into/as Y"
  const groupNL = content.match(
    /group\s+(?:the\s+)?(.+?)(?:\s+related)?\s+channels?\s+(?:into|as|like|similar to)\s+(?:a\s+)?(?:group|category|section)?\s*(?:called|named)?\s*["']?(.+?)["']?$/i
  );

  if (groupNL) {
    const [, descriptor, targetPattern] = groupNL;
    return {
      action: 'group',
      descriptor: descriptor.trim(),
      targetPattern: targetPattern.trim()
    };
  }

  // Pattern: "create a channel called X in Y"
  const createCh = content.match(
    /create\s+(?:a\s+)?(?:new\s+)?(?:text\s+|voice\s+)?channel\s+(?:called\s+|named\s+)?["']?(\S+)["']?(?:\s+in\s+["']?(.+?)["']?)?$/i
  );

  if (createCh) {
    return {
      action: 'create-channel',
      name: createCh[1],
      category: createCh[2] || null
    };
  }

  // Pattern: "rename X to Y"
  const rename = content.match(
    /rename\s+(?:#)?(\S+)\s+to\s+["']?(\S+)["']?$/i
  );

  if (rename) {
    return { action: 'rename', oldName: rename[1], newName: rename[2] };
  }

  // Pattern: "move X to Y"
  const move = content.match(
    /move\s+(?:#)?(\S+)\s+to\s+["']?(.+?)["']?$/i
  );

  if (move) {
    return { action: 'move', channel: move[1], category: move[2] };
  }

  return { action: 'unknown' };
}
```

### Resolve Channels by Descriptor

When a user says "skill-factory related channels," find all channels matching the theme.

```javascript
function resolveChannelsByDescriptor(guild, descriptor) {
  const allChannels = guild.channels.cache.filter(c => c.type !== 4); // exclude categories

  // Direct keyword matching
  const keywords = descriptor
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(w => !['the', 'related', 'channels', 'channel'].includes(w));

  const matches = allChannels.filter(ch => {
    const name = ch.name.toLowerCase();
    return keywords.some(kw => name.includes(kw));
  });

  return matches;
}
```

```javascript
// Example: descriptor = "skill-factory"
// Matches: skill-factory, skill-registry, skill-digest
// Also match by proximity: idea-inbox, prompt-refiner (same uncategorized group)

function resolveByProximity(guild, descriptor) {
  const directMatches = resolveChannelsByDescriptor(guild, descriptor);

  if (!directMatches.size) return directMatches;

  // Find channels adjacent to the direct matches (same parent or no parent)
  const anchor = directMatches.first();
  const parentId = anchor.parentId;

  if (parentId) {
    // Already in a category — return all siblings
    return guild.channels.cache.filter(
      c => c.parentId === parentId && c.type !== 4
    );
  }

  // No parent — find uncategorized channels near the anchor's position
  const uncategorized = guild.channels.cache
    .filter(c => !c.parentId && c.type !== 4)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const anchorPos = anchor.rawPosition;
  return uncategorized.filter(c =>
    Math.abs(c.rawPosition - anchorPos) <= 5 ||
    directMatches.has(c.id)
  );
}
```

### Execute Natural Language Group Request

```javascript
async function handleNaturalGroup(message, descriptor, targetPattern) {
  const guild = message.guild;

  // Resolve channels
  let channels = resolveByProximity(guild, descriptor);

  if (!channels.size) {
    await message.reply(`❌ No channels found matching "${descriptor}".`);
    return;
  }

  // Determine category name
  let categoryName;
  const existingCategory = guild.channels.cache.find(
    c => c.type === 4 && c.name.toLowerCase().includes(targetPattern.toLowerCase())
  );

  if (existingCategory) {
    // "similar to 3D Printing" — use as naming reference but create new
    categoryName = deriveGroupName(descriptor);
  } else if (targetPattern) {
    categoryName = targetPattern;
  } else {
    categoryName = deriveGroupName(descriptor);
  }

  // Present plan and confirm
  const channelList = channels.map(c => `  • #${c.name}`).join('\n');
  await message.reply(
    `**🔧 Plan: Create "${categoryName}" category**\n` +
    `Channels to move:\n${channelList}\n\n` +
    `React ✅ to confirm or ❌ to cancel.`
  );

  const confirmation = await awaitConfirmation(message);
  if (!confirmation) return;

  // Execute
  const category = await guild.channels.create({
    name: categoryName,
    type: 4
  });

  for (const [, ch] of channels) {
    await ch.setParent(category.id, { lockPermissions: false });
  }

  await message.channel.send(
    `✅ **Created "${categoryName}"** with ${channels.size} channels:\n${channelList}`
  );
}

function deriveGroupName(descriptor) {
  return descriptor
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}
```

### `!create-channel <name> [category]` — Create a New Channel

```javascript
const createMatch = message.content.match(
  /^!create-channel\s+(\S+)(?:\s+in\s+["']?(.+?)["']?)?$/i
);

if (createMatch) {
  const [, channelName, categoryName] = createMatch;
  const guild = message.guild;

  let parent = null;
  if (categoryName) {
    parent = guild.channels.cache.find(
      c => c.type === 4 && c.name.toLowerCase() === categoryName.toLowerCase()
    );
    if (!parent) {
      await message.reply(`Category "${categoryName}" not found. Create it first with \`!create-category\`.`);
      return;
    }
  }

  const newChannel = await guild.channels.create({
    name: channelName,
    type: 0, // GuildText
    parent: parent?.id || null,
  });

  await message.channel.send(
    `✅ Created #${newChannel.name}` +
    (parent ? ` in **${parent.name}**` : '') +
    `. ID: \`${newChannel.id}\``
  );
}
```

### `!create-category <name>` — Create a New Category

```javascript
const catMatch = message.content.match(/^!create-category\s+["']?(.+?)["']?\s*$/i);
if (catMatch) {
  const category = await message.guild.channels.create({
    name: catMatch[1],
    type: 4, // GuildCategory
  });
  await message.channel.send(`✅ Created category **${category.name}**. ID: \`${category.id}\``);
}
```

### `!move <channel> to <category>` — Move a Channel

```javascript
const moveMatch = message.content.match(/^!move\s+#?(\S+)\s+to\s+["']?(.+?)["']?\s*$/i);
if (moveMatch) {
  const [, channelName, categoryName] = moveMatch;
  const guild = message.guild;

  const channel = guild.channels.cache.find(
    c => c.name.toLowerCase() === channelName.toLowerCase() && c.type !== 4
  );
  const category = guild.channels.cache.find(
    c => c.type === 4 && c.name.toLowerCase() === categoryName.toLowerCase()
  );

  if (!channel) { await message.reply(`Channel \`${channelName}\` not found.`); return; }
  if (!category) { await message.reply(`Category \`${categoryName}\` not found.`); return; }

  await channel.setParent(category.id, { lockPermissions: false });
  await message.channel.send(`✅ Moved #${channel.name} → **${category.name}**`);
}
```

### `!rename <channel> <new-name>` — Rename a Channel

```javascript
const renameMatch = message.content.match(/^!rename\s+#?(\S+)\s+(?:to\s+)?(\S+)\s*$/i);
if (renameMatch) {
  const [, oldName, newName] = renameMatch;
  const channel = message.guild.channels.cache.find(
    c => c.name.toLowerCase() === oldName.toLowerCase()
  );

  if (!channel) { await message.reply(`Channel \`${oldName}\` not found.`); return; }

  const previousName = channel.name;
  await channel.setName(newName);
  await message.channel.send(`✅ Renamed \`#${previousName}\` → \`#${newName}\``);
}
```

### `!channels` — List Server Structure

```javascript
if (message.content.trim() === '!channels') {
  const guild = message.guild;
  const categories = guild.channels.cache
    .filter(c => c.type === 4)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const uncategorized = guild.channels.cache
    .filter(c => !c.parentId && c.type !== 4)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  let output = '**📂 Server Structure**\n\n';

  if (uncategorized.size) {
    output += '**[Uncategorized]**\n';
    for (const [, ch] of uncategorized) {
      const icon = ch.type === 2 ? '🔊' : '#';
      output += `  ${icon} ${ch.name}\n`;
    }
    output += '\n';
  }

  for (const [, cat] of categories) {
    const children = guild.channels.cache
      .filter(c => c.parentId === cat.id)
      .sort((a, b) => a.rawPosition - b.rawPosition);

    output += `**${cat.name}** (${children.size} channels)\n`;
    for (const [, ch] of children) {
      const icon = ch.type === 2 ? '🔊' : '#';
      output += `  ${icon} ${ch.name}\n`;
    }
    output += '\n';
  }

  await message.channel.send(output);
}
```

### `!archive <channel>` — Archive a Channel

Move a channel to an "Archive" category and restrict access.

```javascript
const archiveMatch = message.content.match(/^!archive\s+#?(\S+)\s*$/i);
if (archiveMatch) {
  const channelName = archiveMatch[1];
  const guild = message.guild;
  const channel = guild.channels.cache.find(
    c => c.name.toLowerCase() === channelName.toLowerCase() && c.type !== 4
  );

  if (!channel) { await message.reply(`Channel \`${channelName}\` not found.`); return; }

  // Find or create Archive category
  let archive = guild.channels.cache.find(
    c => c.type === 4 && c.name.toLowerCase() === 'archive'
  );

  if (!archive) {
    archive = await guild.channels.create({
      name: 'Archive',
      type: 4,
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          deny: ['ViewChannel'],
        },
        {
          id: guild.members.me.id, // bot
          allow: ['ViewChannel'],
        }
      ]
    });
  }

  await channel.setParent(archive.id, { lockPermissions: false });
  await channel.permissionOverwrites.edit(guild.id, { ViewChannel: false });

  await message.channel.send(
    `📦 **#${channel.name}** archived. It's hidden from most users but preserved.`
  );
}
```

### `!reorder <category> <channel1, channel2, ...>` — Set Channel Order

```javascript
const reorderMatch = message.content.match(
  /^!reorder\s+["']?(.+?)["']?\s+(.+)$/i
);

if (reorderMatch) {
  const [, categoryName, channelListRaw] = reorderMatch;
  const guild = message.guild;

  const category = guild.channels.cache.find(
    c => c.type === 4 && c.name.toLowerCase() === categoryName.toLowerCase()
  );

  if (!category) { await message.reply(`Category \`${categoryName}\` not found.`); return; }

  const channelNames = channelListRaw.split(/[,\s]+/).map(c => c.replace(/^#/, '').trim());

  for (let i = 0; i < channelNames.length; i++) {
    const ch = guild.channels.cache.find(
      c => c.parentId === category.id && c.name.toLowerCase() === channelNames[i].toLowerCase()
    );
    if (ch) {
      await ch.setPosition(i);
    }
  }

  await message.channel.send(
    `✅ Reordered channels in **${category.name}**:\n` +
    channelNames.map((n, i) => `  ${i + 1}. #${n}`).join('\n')
  );
}
```

## Confirmation Helper

```javascript
async function awaitConfirmation(message, timeoutMs = 30000) {
  try {
    const collected = await message.channel.awaitReactions({
      filter: (reaction, user) =>
        ['✅', '❌'].includes(reaction.emoji.name) &&
        user.id === message.author.id,
      max: 1,
      time: timeoutMs,
      errors: ['time']
    });

    return collected.first()?.emoji.name === '✅';
  } catch {
    await message.reply('⏰ Timed out. No changes made.');
    return false;
  }
}
```

## Tips

- Natural language parsing is best-effort. If intent is ambiguous, the skill asks for clarification instead of guessing.
- `!group` always creates a NEW category. To move channels into an existing category, use `!move`.
- Confirmation is mandatory for `!group`, `!archive`, and bulk operations. Single-channel `!move` and `!rename` execute immediately.
- `!archive` creates a hidden "Archive" category on first use. Archived channels are preserved, not deleted.
- Channel names in Discord cannot contain spaces — use hyphens. The skill auto-converts spaces to hyphens.
- The bot needs `MANAGE_CHANNELS` at the guild level, not just per-channel. Category creation requires guild-level perms.
- `!channels` is your debugging friend. Run it after any structural change to verify the result.
- `lockPermissions: false` in `setParent()` preserves channel-specific permission overrides when moving to a new category.
- When grouping "similar to 3D Printing," the skill uses the reference category as a naming hint, not a permission template.
- Reordering only affects channels within a single category. Cross-category reordering requires `!move` first.
