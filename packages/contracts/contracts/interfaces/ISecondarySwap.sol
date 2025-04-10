// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ISecondarySwap {
  function uniswapFee() external view returns (uint24);
  function zoraTimedSaleStrategy() external view returns (address);
  function swapRouter() external view returns (address);
  function WETH() external view returns (address);

  struct Order {
    address pool;
    uint256 amount;
    uint256 price;
    uint160 sqrtPriceLimitX96;
    address collection;
    uint256 tokenId;
  }
  
  function buy1155(
    address erc20zAddress,
    uint256 num1155ToBuy,
    address payable recipient,
    address payable excessRefundRecipient,
    uint256 maxEthToSpend,
    uint160 sqrtPriceLimitX96
  ) external payable;

  function sell1155(
    address erc20zAddress,
    uint256 num1155ToSell,
    address payable recipient,
    uint256 minEthToAcquire,
    uint160 sqrtPriceLimitX96
  ) external;
}
