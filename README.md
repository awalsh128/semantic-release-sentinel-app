# semantic-release-sentinel-app

> A GitHub App built with [Probot](https://github.com/probot/probot) that GitHub App to callout semantic release concerns and flag potential implications.

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t semantic-release-sentinel-app .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> semantic-release-sentinel-app
```

## Contributing

If you have suggestions for how semantic-release-sentinel-app could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2026 awalsh128
