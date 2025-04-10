ARG TAG

FROM ghcr.io/reservoirprotocol/indexer:latest-builder-${TAG} as builder

WORKDIR /indexer
ADD packages packages
RUN yarn build


FROM ghcr.io/reservoirprotocol/indexer:latest-base-${TAG} AS indexer

ARG PORT=80

COPY --chown=root:root --from=builder /indexer/packages/indexer/package.json /indexer/packages/indexer
COPY --chown=root:root --from=builder /indexer/packages/indexer/dist /indexer/packages/indexer/dist
COPY --chown=root:root --from=builder /indexer/packages/indexer/src/migrations /indexer/packages/indexer/src/migrations

COPY --chown=root:root --from=builder /indexer/packages/mint-interface/package.json /indexer/packages/mint-interface
COPY --chown=root:root --from=builder /indexer/packages/mint-interface/dist /indexer/packages/mint-interface/dist

COPY --chown=root:root --from=builder /indexer/packages/sdk/package.json /indexer/packages/sdk
COPY --chown=root:root --from=builder /indexer/packages/sdk/dist /indexer/packages/sdk/dist

COPY --chown=root:root --from=builder /indexer/package.json /indexer/yarn.lock /indexer/turbo.json /indexer

CMD yarn start

EXPOSE ${PORT}
