export interface CurrencyRate {
  currency: string;
  unitsPerUsd: number;
  lastUpdated: Date;
}

export class CurrencyConverter {
  private rates: Map<string, number> = new Map([
    ['USD', 1.0],
    ['EUR', 0.92],
    ['KES', 130.5], // Kenya Shillings
    ['UGX', 3720.0], // Uganda Shillings
    ['TZS', 2650.0], // Tanzania Shillings
    ['NGN', 1580.0], // Nigerian Naira
    ['GHS', 15.6], // Ghanaian Cedi
  ]);

  public setRate(currency: string, unitsPerUsd: number): void {
    this.rates.set(currency.toUpperCase(), unitsPerUsd);
  }

  public getRate(currency: string): number {
    const rate = this.rates.get(currency.toUpperCase());
    if (!rate) {
      throw new Error(`Unsupported payment fiat currency: ${currency}`);
    }
    return rate;
  }

  /**
   * Converts local fiat amount to Soroban token units (with 7 decimals precision)
   * e.g. 1305 KES -> 10.00 USD -> 100_000_000 units
   */
  public convertFiatToToken(
    fiatAmount: number,
    fiatCurrency: string,
    decimals = 7
  ): { tokenUnits: bigint; usdValue: number; exchangeRate: number } {
    const rate = this.getRate(fiatCurrency);
    const usdValue = fiatAmount / rate;
    const factor = Math.pow(10, decimals);
    const tokenUnits = BigInt(Math.round(usdValue * factor));

    return {
      tokenUnits,
      usdValue,
      exchangeRate: rate,
    };
  }

  /**
   * Converts token units back to local fiat amount
   */
  public convertTokenToFiat(
    tokenUnits: bigint,
    fiatCurrency: string,
    decimals = 7
  ): { fiatAmount: number; usdValue: number } {
    const rate = this.getRate(fiatCurrency);
    const factor = Math.pow(10, decimals);
    const usdValue = Number(tokenUnits) / factor;
    const fiatAmount = usdValue * rate;

    return {
      fiatAmount: Math.round(fiatAmount * 100) / 100,
      usdValue,
    };
  }
}

export const currencyConverter = new CurrencyConverter();
