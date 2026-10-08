#!/usr/bin/env bash
# Giá crypto NHANH — CoinGecko (FREE, KHÔNG cần key). Trả JSON: giá, %24h/7d/30d, market cap.
# Dùng: ~/lucy/tools/crypto.sh bitcoin ethereum solana binancecoin ripple
# (dùng CoinGecko id, không phải ticker: bitcoin/ethereum/solana/binancecoin/ripple/cardano/dogecoin...)
IDS="$*"; [ -z "$IDS" ] && IDS="bitcoin ethereum solana binancecoin ripple"
IDS="${IDS// /,}"
curl -s --max-time 15 -H 'accept: application/json' \
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${IDS}&price_change_percentage=24h,7d,30d&sparkline=false"
echo
