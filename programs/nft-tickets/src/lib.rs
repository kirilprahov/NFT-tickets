use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};
use anchor_spl::{metadata::{set_and_verify_sized_collection_item, SetAndVerifySizedCollectionItem}};
use mpl_token_metadata::accounts::Metadata;
use mpl_token_metadata::instructions::CreateV1CpiBuilder;
use mpl_token_metadata::types::{Collection, CollectionDetails, PrintSupply, TokenStandard};
declare_id!("UdaXXAyGLw94jH4e3nqFmHdkKvPe1rgUxi9h8N1V4cT");

#[program]
pub mod nft_tickets {
    use super::*;
    pub fn init_mint(ctx: Context<InitMint>) -> Result<()> {
        helpers::init_mint(ctx)
    }
    pub fn mint_nft(ctx: Context<MintOne>) -> Result<()> {
        helpers::mint_nft(ctx)
    }
    pub fn collection_init(
        ctx: Context<MetadataInit>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
    ) -> Result<()> {
        helpers::collection_init(ctx, name, symbol, uri, seller_fee_basis_points)
    }
    pub fn ticket_init(
        ctx: Context<MetadataInit>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
    ) -> Result<()> {
        helpers::ticket_init(ctx, name, symbol, uri, seller_fee_basis_points)
    }
    pub fn verify_collection(ctx: Context<VerifyCollection>) -> Result<()> {
        helpers::verify_collection(ctx)
    }

}

pub mod helpers {
    use anchor_lang::solana_program::program::invoke_signed;
    use anchor_lang::solana_program::system_program;
    use super::*;
    use mpl_token_metadata::instructions::{CreateV1, CreateV1InstructionArgs};
    use mpl_token_metadata::types::{CreateArgs, UseMethod, Uses};

    pub fn init_mint(_ctx: Context<InitMint>) -> Result<()> {
        msg!("Mint initialized");
        Ok(())
    }

    pub fn mint_nft(ctx: Context<MintOne>) -> Result<()> {
        let bump = ctx.bumps.mint_authority;
        let signer_seeds: &[&[u8]] = &[b"mint_authority", &[bump]];
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
            1,
        )?;
        Ok(())
    }

    pub fn collection_init(
        ctx:Context<MetadataInit>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16
    ) -> Result<()> {
        let (expected_md_pda, _) = Metadata::find_pda(&ctx.accounts.mint.key());
        require_keys_eq!(expected_md_pda, ctx.accounts.metadata.key(), ErrorCode::MetadatapdaMismatch);

        let mint_auth_bump = ctx.bumps.mint_authority;
        let signer_seeds: &[&[u8]] = &[b"mint_authority", &[mint_auth_bump]];

        let create_cpi = CreateV1CpiBuilder::new(&ctx.accounts.token_metadata_program)
            .metadata(&ctx.accounts.metadata.to_account_info())
            .mint(&ctx.accounts.mint.to_account_info(), false)
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
            .seller_fee_basis_points(seller_fee_basis_points)
            .token_standard(TokenStandard::NonFungible)
            .print_supply(PrintSupply::Zero)
            .decimals(0)
            .collection_details(CollectionDetails::V1 { size: 0 })
            .invoke_signed(&[signer_seeds]);
        Ok(())
    }
    pub fn ticket_init(
        ctx:Context<MetadataInit>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16
    ) -> Result<()> {
        let (expected_md_pda, _) = Metadata::find_pda(&ctx.accounts.mint.key());
        require_keys_eq!(expected_md_pda, ctx.accounts.metadata.key(), ErrorCode::MetadatapdaMismatch);
        let collection = Collection {
            verified: false,
            key: ctx.accounts.collection.take().expect("Collection fail").key(),
        };
        let mint_auth_bump = ctx.bumps.mint_authority;
        let signer_seeds: &[&[u8]] = &[b"mint_authority", &[mint_auth_bump]];

        let create_cpi = CreateV1CpiBuilder::new(&ctx.accounts.token_metadata_program)
            .metadata(&ctx.accounts.metadata.to_account_info())
            .mint(&ctx.accounts.mint.to_account_info(), false)
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
            .seller_fee_basis_points(seller_fee_basis_points)
            .token_standard(TokenStandard::NonFungible)
            .print_supply(PrintSupply::Zero)
            .decimals(0)
            .collection(collection)
            .invoke_signed(&[signer_seeds]);



        Ok(())
    }
    pub fn verify_collection(ctx: Context<VerifyCollection>) -> Result<()> {
        let mint_auth_bump = ctx.bumps.mint_authority;
        let signer_seeds: &[&[u8]] = &[b"mint_authority", &[mint_auth_bump]];
        let binding = [signer_seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            SetAndVerifySizedCollectionItem {
                metadata: ctx.accounts.metadata.to_account_info(),
                collection_authority: ctx.accounts.mint_authority.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.mint_authority.to_account_info(),
                collection_mint: ctx.accounts.collection_mint.to_account_info(),
                collection_metadata: ctx.accounts.collection_metadata.to_account_info(),
                collection_master_edition: ctx.accounts.collection_master_edition.to_account_info(),
            },
            &binding,
        );
        set_and_verify_sized_collection_item(cpi_ctx, None)?;

        Ok(())
    }


}

#[derive(Accounts)]
pub struct MintOne<'info> {
    #[account(mut)]
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
    payer = payer,
    mint::decimals = 0,
    mint::authority = mint_authority,
    mint::freeze_authority = mint_authority,
    mint::token_program = token_program,
    )]
    pub mint: Account<'info, Mint>,
    /// CHECK:
    #[account(seeds = [b"mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct VerifyCollection<'info> {
    #[account(mut)]
    pub collection_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    #[account(seeds = [b"mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub collection_master_edition: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(address = mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MetadataInit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
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
    /// CHECK:
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
