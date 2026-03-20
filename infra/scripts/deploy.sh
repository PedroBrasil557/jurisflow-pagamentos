#!/bin/bash

export AWS_PROFILE=jurisflow

if [[ "$1" == "-p" ]]; then
  export DEPLOY_ENV=prod
else
  export DEPLOY_ENV=dev
fi

cd ../web
bun install --frozen-lockfile
bun run build

cd ../infra
yarn install --frozen-lockfile

yarn cdk deploy --all --require-approval never
