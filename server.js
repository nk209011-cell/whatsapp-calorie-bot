// server.js
import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs-extra';
import path from 'path';
import Twilio from 'twilio';
import cors from 'cors';

const __dirname = path.resolve();
const DATA_FILE = path.join(__dirname, 'data.json');
await fs.ensureFile(DATA_FILE);

// Read & Write Data
const readData = async () => {
  const txt = await fs.readFile(DATA_FILE, 'utf8').catch(() => '{}');
  return JSON.parse(txt || '{}');
};
const writeData = async (d) => fs.writeFile(DATA_FILE, JSON.stringify(d, null, 2));

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Parse “250 oats”, “add 250 oats”, etc.
function tryParseAdd(text) {
  const match = text.match(/(\d{2,5})/);
  if (!match) return null;
  const calories = parseInt(match[1], 10);
  const item = text.replace(match[0], '').replace(/\badd\b/i, '').trim();
  if (!item) return null;
  return { calories, item };
}

app.post('/webhook', async (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();
  const who = from.replace('whatsapp:', '');
  const data = await readData();
  data[who] = data[who] || { entries: [] };

  const tokens = body.split(/\s+/);
  const cmd = tokens[0] ? tokens[0].toLowerCase() : '';
  let reply = '';

  if (cmd === 'add') {
    const calories = parseInt(tokens[1], 10);
    if (!calories || tokens.length < 3) {
      reply = 'Usage: add <calories> <item>\nExample: add 350 brown rice';
    } else {
      const item = tokens.slice(2).join(' ');
      const entry = { id: Date.now(), date: new Date().toISOString(), calories, item };
      data[who].entries.push(entry);
      await writeData(data);
      reply = `Saved: ${calories} kcal — ${item}`;
    }
  } else if (cmd === 'total') {
    const today = new Date().toISOString().slice(0, 10);
    const total = (data[who].entries || [])
      .filter(e => e.date.slice(0,10) === today)
      .reduce((s,e) => s + e.calories, 0);
    reply = `Today (${today}) total: ${total} kcal`;
  } else if (cmd === 'entries') {
    const last = (data[who].entries || []).slice(-10).reverse();
    reply = last.length
      ? 'Recent entries:\n' + last.map(e => `${e.calories} kcal • ${e.item} (${e.date.slice(0,10)})`).join('\n')
      : 'No entries yet. Use: add <calories> <item>';
  } else if (cmd === 'export') {
    const userEntries = data[who].entries || [];
    if (!userEntries.length) reply = 'No entries to export.';
    else {
      reply = `Download CSV: ${req.protocol}://${req.get('host')}/export/${encodeURIComponent(who)}`;
      await writeData(data);
    }
  } else if (cmd === 'help') {
    reply = 'Commands:\nadd <cal> <item>\ntotal\nentries\nexport\nhelp';
  } else {
    const parsed = tryParseAdd(body);
    if (parsed) {
      const entry = { id: Date.now(), date: new Date().toISOString(), calories: parsed.calories, item: parsed.item };
      data[who].entries.push(entry);
      await writeData(data);
      reply = `Saved: ${parsed.calories} kcal — ${parsed.item}`;
    } else {
      reply = 'Hi! CalorieBot here.\nCommands:\nadd <cal> <item>\ntotal\nentries\nexport\nhelp';
    }
  }

  const twiml = new Twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// Export CSV
app.get('/export/:who', async (req, res) => {
  const who = req.params.who;
  const data = await readData();
  const userEntries = (data[who] && data[who].entries) ? data[who].entries : [];

  const csv = [
    'id,date,calories,item',
    ...userEntries.map(e => `${e.id},"${e.date}",${e.calories},"${e.item.replace(/"/g,'""')}"`)
  ].join('\n');

  res.setHeader('Content-disposition', `attachment; filename=calories-${who}.csv`);
  res.set('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/', (req,res) => res.send('Calorie WhatsApp Bot is running'));
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
