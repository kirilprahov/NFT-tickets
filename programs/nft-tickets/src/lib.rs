use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Token, Mint, TokenAccount, mint_to, MintTo,};
use anchor_lang::solana_program;
use mpl_token_metadata::accounts::Metadata;
use mpl_token_metadata::instructions::CreateV1CpiBuilder;
use mpl_token_metadata::types::{Collection, CollectionDetails, PrintSupply, TokenStandard};
declare_id!("UdaXXAyGLw94jH4e3nqFmHdkKvPe1rgUxi9h8N1V4cT");

#[program]
pub mod nft_tickets {
    use super::*;

}

mod helpers {

    use super::*;

    pub fn init_mint(_ctx: Context<InitMint>) -> Result<()> {
        msg!("Mint initialized");
        Ok(())
    }

    pub fn mint_nft(ctx: Context<MintOne>) -> Result<()> {
        let bump = ctx.bumps.mint;
        let signer_seeds: &[&[u8]] = &[b"mint", &[bump]];
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.associated_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[signer_seeds],
            ),
            1
        )?;
        Ok(())
    }

    pub fn collection_init(
        ctx:Context<CollectionInit>,
        name: String,
        symbol: String,
        uri: String,

    ) -> Result<()> {
        let (expected_md_pda, _) = Metadata::find_pda(&ctx.accounts.mint.key());
        let mut collection_arg: Option<Collection> = None;
        let mut collection_details_arg: Option<CollectionDetails> = None;
        if let Some(col_mint_ai) = ctx.accounts.collection.as_ref() {
            collection_arg = Some(Collection {
                key: col_mint_ai.key(),
                verified: false,
            });
        } else {
            collection_details_arg = Some(CollectionDetails::V1 { size: 0 });
        }
        require_keys_eq!(expected_md_pda, ctx.accounts.metadata.key(), ErrorCode::MetadatapdaMismatch);

        let create_cpi = CreateV1CpiBuilder::new(&ctx.accounts.token_metadata_program)
            .metadata(&ctx.accounts.metadata.to_account_info())
            .mint(&ctx.accounts.mint.to_account_info(), true)
            .authority(&ctx.accounts.mint_authority.to_account_info())
            .payer(&ctx.accounts.payer.to_account_info())
            .update_authority(&ctx.accounts.mint_authority.to_account_info(), false)
            .master_edition(Some(&ctx.accounts.master_edition))
            .system_program(&ctx.accounts.system_program)
            .sysvar_instructions(&ctx.accounts.sysvar_instructions)
            .spl_token_program(Some(&ctx.accounts.token_program.to_account_info()))
            .name(name)
            .symbol(symbol)
            .uri(uri)
            .seller_fee_basis_points(550)
            .token_standard(TokenStandard::NonFungible)
            .print_supply(PrintSupply::Zero)
            .decimals(0)
            .collection(collection_arg.unwrap())
            .collection_details(collection_details_arg.unwrap());
        let mint_auth_bump = ctx.bumps.mint_authority;
        let signer_seeds: &[&[u8]] = &[b"mint_authority", &[mint_auth_bump]];
        create_cpi.invoke()?;
        Ok(())
    }

}

#[derive(Accounts)]
pub struct MintOne<'info> {
    #[account(
    seeds = [b"mint"],
    bump,
    mut,
    )]
    pub mint: Account<'info, Mint>,
    /// CHECK:
    #[account(seeds = [b"mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
    init_if_needed,
    payer = payer,
    associated_token::mint = mint,
    associated_token::authority = payer,
    )]
    pub associated_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct InitMint<'info> {
    #[account(
    init,
    seeds = [b"mint"],
    bump,
    payer = payer,
    mint::decimals = 0,
    mint::authority = mint_authority,
    mint::token_program = token_program,
    )]
    pub mint: Account<'info, Mint>,
    /// CHECK:
    #[account(seeds = [b"mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectionInit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"mint"], bump)]
    pub mint: Account<'info, Mint>,
    ///CHECK
    #[account(mut)]
    pub collection: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,
    #[account(address = mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK:
    #[account(seeds = [b"mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    /// CHECK:
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Metadata PDA mismatch")]
    MetadatapdaMismatch,
}