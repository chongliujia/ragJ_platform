# Use a multi-stage build to avoid issues with missing tools in the ES image.

# Stage 1: The "builder" stage
# Use a lean image that has curl and unzip to download and extract the plugin.
FROM alpine:3.18 as builder

# Install necessary tools
RUN apk --no-cache add curl unzip jq

# Download and unzip the plugin to a specific directory
WORKDIR /plugins
# Use the GitHub API to get the real download URL, which is more reliable than a direct link
RUN LATEST_URL=$(curl -s https://api.github.com/repos/infinilabs/analysis-ik/releases/tags/v8.11.3 | jq -r ".assets[] | select(.name==\"elasticsearch-analysis-ik-8.11.3.zip\") | .browser_download_url") && \
    curl -L -o ik.zip $LATEST_URL && \
    unzip ik.zip && \
    rm ik.zip

# Stage 2: The final Elasticsearch image
FROM elasticsearch:8.11.3

# Copy the extracted plugin from the "builder" stage into the correct directory
COPY --from=builder /plugins/* /usr/share/elasticsearch/plugins/ik/ 