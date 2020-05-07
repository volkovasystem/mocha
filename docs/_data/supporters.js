#!/usr/bin/env node
'use strict';

const debug = require('debug')('mocha:docs:data:supporters');
const needle = require('needle');

const REQUIRED_KEYS = ['totalDonations', 'slug', 'name'];

const API_ENDPOINT = 'https://api.opencollective.com/graphql/v2';

const query = `query account($limit: Int, $offset: Int, $slug: String) {
  account(slug: $slug) {
    orders(limit: $limit, offset: $offset) {
      limit
      offset
      totalCount
      nodes {
        fromAccount {
          name
          slug
          website
          imageUrl(height:32)
        }
        totalDonations {
          value
        }
        tier {
          slug
        }
        createdAt
      }
    }
  }
}`;

const graphqlPageSize = 1000;

const nodeToSupporter = node => ({
  name: node.fromAccount.name, 
  slug: node.fromAccount.slug,
  website: node.fromAccount.website,
  avatar: node.fromAccount.imageUrl,
  tier: node.tier ? node.tier.slug : 'sponsors',
  firstDonation: node.createdAt,
  totalDonations: node.totalDonations.value * 100
});

const getAllOrders = async (slug = 'mochajs') => {
  let allOrders = [];
  const variables = {limit: graphqlPageSize, offset: 0, slug};

  // Handling pagination if necessary (2 pages for ~1400 results in May 2019)
  // eslint-disable-next-line
  while (true) {
    const result = await needle(
      'post',
      API_ENDPOINT,
      {query, variables},
      {json: true}
    );
    const orders = result.body.data.account.orders.nodes;
    allOrders = [...allOrders, ...orders];
    variables.offset += graphqlPageSize;
    if (orders.length < graphqlPageSize) {
      debug('retrieved %d orders', allOrders.length);
      return allOrders;
    } else {
      debug(
        'loading page %d of orders...',
        Math.floor(variables.offset / graphqlPageSize)
      );
    }
  }
};

module.exports = async () => {
  const orders = await getAllOrders();
  let supporters = orders
    .map(nodeToSupporter)
    .sort((a, b) => b.totalDonations - a.totalDonations);

  // Deduplicating supporters with multiple orders
  const seenSupporters = new Set();
  supporters = supporters.reduce((supporters, supporter) => {
    if (!seenSupporters.has(supporter.slug)) {
      seenSupporters.add(supporter.slug);
      supporters.push(supporter);
    }
    return supporters;
  }, []);

  if (!Array.isArray(supporters)) {
    throw new Error('Supporters data is not an array.');
  }

  for (const item of supporters) {
    for (const key of REQUIRED_KEYS) {
      if (!item || typeof item !== 'object') {
        throw new Error(
          `Supporters: ${JSON.stringify(item)} is not an object.`
        );
      }
      if (!(key in item)) {
        throw new Error(
          `Supporters: ${JSON.stringify(item)} doesn't include ${key}.`
        );
      }
    }
  }

  // sort into buckets by tier
  const backers = supporters.filter(supporter => supporter.tier === 'backers');
  const sponsors = supporters.filter(supporter => supporter.tier === 'sponsors');
  
  debug('found %d backers and %d sponsors', backers.length, sponsors.length);
  return {backers, sponsors};
};
