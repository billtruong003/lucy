#!/usr/bin/env bash
# Tổng quan thị trường crypto NHANH — CoinGecko (FREE). Trả JSON: total mcap, volume, BTC dominance, %24h.
curl -s --max-time 15 -H 'accept: application/json' "https://api.coingecko.com/api/v3/global"
echo
