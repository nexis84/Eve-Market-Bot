# Test Commands

To test your migrated bot, you can run:

```bash
# Set your environment variables first
$env:TWITCH_OAUTH_TOKEN="your_oauth_token_here"
$env:USER_AGENT="EveTwitchMarketBot/1.5.0"

# Then start the bot
npm start
```

Test the following commands in your Twitch chat:
- `!ping` - Check bot connectivity
- `!market tritanium` - Test market data lookup
- `!info plex` - Test item info lookup
- `!build venture` - Test blueprint cost calculation
- `!lp Caldari Navy | Caldari Navy Antimatter Charge S` - Test LP store lookup

The bot should respond normally with the updated packages.
