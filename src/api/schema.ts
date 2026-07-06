export const typeDefs = `#graphql
  enum Interval {
    DAILY
    WEEKLY
    MONTHLY
  }

  type PricePoint {
    date: String!
    priceUsd: Float!
    marketCap: Float
    volume: Float
  }

  type Query {
    historicalPrices(
      coin: String!
      from: String!
      to: String!
      interval: Interval = WEEKLY
    ): [PricePoint!]!
  }
`;
