FROM node:26.13.1-alpine AS build
RUN npm install --global --no-audit --no-fund corepack@0.35.0
WORKDIR /work/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile --reporter=append-only
COPY contracts /work/contracts
COPY frontend .
RUN corepack pnpm build

FROM nginx:1.30.1-alpine
ARG VCS_REF=development
LABEL org.opencontainers.image.revision=$VCS_REF
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /work/frontend/dist /usr/share/nginx/html
EXPOSE 8080
