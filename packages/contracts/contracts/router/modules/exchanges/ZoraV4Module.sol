// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

import {BaseExchangeModule} from "./BaseExchangeModule.sol";
import {BaseModule} from "../BaseModule.sol";

import {ISecondarySwap} from "../../../interfaces/ISecondarySwap.sol";

contract ZoraV4Module is BaseExchangeModule {
  // --- Fields ---

  ISecondarySwap public immutable SECONDARY_SWAP;

  // --- Constructor ---

  constructor(
    address owner,
    address router,
    address secondarySwap
  ) BaseModule(owner) BaseExchangeModule(router) {
    SECONDARY_SWAP = ISecondarySwap(secondarySwap);
  }

  // --- Fallback ---

  receive() external payable {}

  // --- Multiple ETH listings ---

  function buyWithETH(
    ISecondarySwap.Order[] calldata orders,
    ETHListingParams calldata params,
    Fee[] calldata fees
  )
    external
    payable
    nonReentrant
    refundETHLeftover(params.refundTo)
    chargeETHFees(fees, params.amount)
  {
    uint256 length = orders.length;
    for (uint256 i = 0; i < length; ) {
      ISecondarySwap.Order memory order = orders[i];

      // Execute fill
      _buy(orders[i], params.fillTo, params.revertIfIncomplete, order.price);

      unchecked {
        ++i;
      }
    }
  }

  // --- Internal ---

  function _buy(
    ISecondarySwap.Order calldata buyOrder,
    address receiver,
    bool revertIfIncomplete,
    uint256 value
  ) internal {
    // Execute the fill
    try
      SECONDARY_SWAP.buy1155{value: value}(
        buyOrder.pool,
        buyOrder.amount,
        payable(receiver),
        payable(receiver),
        value,
        buyOrder.sqrtPriceLimitX96
      )
    {} catch {
      // Revert if specified
      if (revertIfIncomplete) {
        revert UnsuccessfulFill();
      }
    }
  }

  // --- Single ERC721 offer ---

  function sell(
    ISecondarySwap.Order[] calldata orders,
    OfferParams calldata params,
    Fee[] calldata fees
  ) external nonReentrant {
    uint256 length = orders.length;
    for (uint256 i = 0; i < length; ) {
      // Execute fill
      _sell(orders[i], params.fillTo, params.revertIfIncomplete, fees);

      unchecked {
        ++i;
      }
    }
  }

  function _sell(
    ISecondarySwap.Order calldata sellOrder,
    address receiver,
    bool revertIfIncomplete,
    Fee[] calldata fees
  ) internal {
    address collection = sellOrder.collection;

    // Execute the sell
    _approveERC1155IfNeeded(IERC1155(collection), address(SECONDARY_SWAP));

    try
      SECONDARY_SWAP.sell1155(
        sellOrder.pool,
        sellOrder.amount,
        payable(receiver),
        sellOrder.price,
        sellOrder.sqrtPriceLimitX96
      )
    {
      // Pay fees
      uint256 feesLength = fees.length;
      for (uint256 i; i < feesLength; ) {
        Fee memory fee = fees[i];
        _sendETH(fee.recipient, fee.amount);
        unchecked {
          ++i;
        }
      }

      // Forward any left payment to the specified receiver
      _sendAllETH(receiver);
    } catch {
      // Revert if specified
      if (revertIfIncomplete) {
        revert UnsuccessfulFill();
      }
    }

    // Refund any ERC1155 leftover
    _sendAllERC1155(receiver, IERC1155(collection), sellOrder.tokenId);
  }

  // --- ERC721 / ERC1155 hooks ---

  // Single token offer acceptance can be done approval-less by using the
  // standard `safeTransferFrom` method together with specifying data for
  // further contract calls. An example:
  // `safeTransferFrom(
  //      0xWALLET,
  //      0xMODULE,
  //      TOKEN_ID,
  //      0xABI_ENCODED_ROUTER_EXECUTION_CALLDATA_FOR_OFFER_ACCEPTANCE
  // )`

  function onERC721Received(
    address, // operator,
    address, // from
    uint256, // tokenId,
    bytes calldata data
  ) external returns (bytes4) {
    if (data.length > 0) {
      _makeCall(router, data, 0);
    }

    return this.onERC721Received.selector;
  }

  function onERC1155Received(
    address, // operator
    address, // from
    uint256, // tokenId
    uint256, // amount
    bytes calldata data
  ) external returns (bytes4) {
    if (data.length > 0) {
      _makeCall(router, data, 0);
    }

    return this.onERC1155Received.selector;
  }
}
