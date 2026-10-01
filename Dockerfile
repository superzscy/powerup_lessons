ARG GO_IMAGE=docker.1ms.run/library/golang:1.26.8-alpine

FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY web ./web
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/powerup-audio .

FROM scratch
WORKDIR /app
COPY --from=build /out/powerup-audio /powerup-audio
EXPOSE 8080
ENV AUDIO_DIR=/app/audios PORT=8080
USER 10001:10001
ENTRYPOINT ["/powerup-audio"]
