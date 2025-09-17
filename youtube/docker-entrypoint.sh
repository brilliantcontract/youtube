#!/bin/sh
set -e

if [ "$1" = "console" ]; then
    shift
    if [ "${1}" ]; then
        exec "$@"
    fi
    exec /bin/sh
fi

exec "$@"