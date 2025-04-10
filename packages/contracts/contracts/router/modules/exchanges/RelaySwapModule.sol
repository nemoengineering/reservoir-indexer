// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseExchangeModule} from "./BaseExchangeModule.sol";
import {BaseModule} from "../BaseModule.sol";
import {IWETH} from "../../../interfaces/IWETH.sol";

// Notes:
// - supports swapping ETH and ERC20 to any token

contract RelaySwapModule is BaseExchangeModule {
  struct TransferDetail {
    address recipient;
    uint256 amount;
  }

  struct Call {
    address to;
    bytes data;
    uint256 value;
  }

  struct Swap {
    address tokenOut;
    Call[] calls;
    TransferDetail[] transfers;
  }

  // --- Fields ---

  IWETH public immutable WETH;

  // --- Constructor ---

  constructor(
    address owner,
    address router,
    address weth
  ) BaseModule(owner) BaseExchangeModule(router) {
    WETH = IWETH(weth);
  }

  // --- Fallback ---

  receive() external payable {}

  // --- Wrap ---

  function wrap(TransferDetail[] calldata targets) external payable nonReentrant {
    WETH.deposit{value: msg.value}();

    uint256 length = targets.length;
    for (uint256 i = 0; i < length; ) {
      // Zero represents "everything"
      uint256 amount = targets[i].amount == 0 ? WETH.balanceOf(address(this)) : targets[i].amount;
      _sendERC20(targets[i].recipient, amount, WETH);

      unchecked {
        ++i;
      }
    }
  }

  // --- Unwrap ---

  function unwrap(TransferDetail[] calldata targets) external nonReentrant {
    uint256 balance = WETH.balanceOf(address(this));
    WETH.withdraw(balance);

    uint256 length = targets.length;
    for (uint256 i = 0; i < length; ) {
      // Zero represents "everything"
      uint256 amount = targets[i].amount == 0 ? address(this).balance : targets[i].amount;
      _sendETH(targets[i].recipient, amount);

      unchecked {
        ++i;
      }
    }
  }

  // --- Swaps ---

  function ethInputSwap(
    Swap[] calldata swaps,
    address refundTo,
    bool revertIfIncomplete
  ) external payable nonReentrant refundETHLeftover(refundTo) {
    _swap(swaps, revertIfIncomplete);
  }

  function erc20InputSwap(
    address tokenIn,
    Swap[] calldata swaps,
    address refundTo,
    bool revertIfIncomplete
  ) external nonReentrant refundERC20Leftover(refundTo, IERC20(tokenIn)) {
    _swap(swaps, revertIfIncomplete);
  }

  // --- Internal methods ---

  function _swap(Swap[] calldata swaps, bool revertIfIncomplete) internal {
    bool success;

    uint256 swapsLength = swaps.length;
    for (uint256 i; i < swapsLength; i++) {
      Swap calldata swap = swaps[i];

      bool allCallsWereSuccessful = true;

      // Execute the calls of the swap
      uint256 callsLength = swap.calls.length;
      for (uint256 j = 0; j < callsLength; j++) {
        Call calldata c = swap.calls[j];

        (success, ) = c.to.call{value: c.value}(c.data);
        if (!success) {
          if (revertIfIncomplete) {
            revert UnsuccessfulFill();
          } else {
            // All swap calls are dependent on one another so no point continuing here
            allCallsWereSuccessful = false;
            break;
          }
        }
      }

      // Execute the required transfers
      if (allCallsWereSuccessful) {
        uint256 transfersLength = swap.transfers.length;
        for (uint256 k = 0; k < transfersLength; k++) {
          TransferDetail calldata transferDetail = swap.transfers[k];
          if (swap.tokenOut == address(0)) {
            // Zero represents "everything"
            uint256 amount = transferDetail.amount == 0
              ? address(this).balance
              : transferDetail.amount;

            _sendETH(transferDetail.recipient, amount);
          } else {
            // Zero represents "everything"
            uint256 amount = transferDetail.amount == 0
              ? IERC20(swap.tokenOut).balanceOf(address(this))
              : transferDetail.amount;

            _sendERC20(transferDetail.recipient, amount, IERC20(swap.tokenOut));
          }
        }
      }
    }
  }
}
