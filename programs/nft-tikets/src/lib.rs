use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_lang::solana_program::sysvar;
use anchor_spl::metadata::{set_and_verify_sized_collection_item, SetAndVerifySizedCollectionItem};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self as spl_if, MintTo},
    token::{Mint, Token, TokenAccount}
};
use mpl_token_metadata::{
    instructions::{CreateCpiBuilder, CreateMasterEditionV3CpiBuilder},
    types::{Collection, CollectionDetails, CreateArgs, Creator, PrintSupply, TokenStandard},
    ID as TOKEN_METADATA_ID,
};

declare_id!("8Z8bsgf7SYGAh1Sy96oz4dfcZtTiPL1pkSLrn6RELkLr");

#[program]
pub mod nft_tikets {
    use super::*;

    pub fn mint_nft_event(
        ctx: Context<Event>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_bps: u16,
        is_mutable: bool,
        price: u64,
        event_ts: u64,
    ) -> Result<()> {
        let bump = ctx.bumps.treasury;
        ctx.accounts.treasury.set_inner(Treasury {
            authority: ctx.accounts.update_authority.key(),
            collection_mint: ctx.accounts.mint.key(),
            event_ts,
            bump,
            price,
        });
        helpers::mint_one_event(&ctx.accounts)?;
        helpers::create_metadata_event(
            &ctx.accounts,
            name,
            symbol,
            uri,
            seller_fee_bps,
            is_mutable,
        )?;
        //helpers::create_master_edition_event(&ctx.accounts)?;
        Ok(())
    }
    pub fn mint_nft_ticket(
        ctx: Context<Ticket>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_bps: u16,
        is_mutable: bool,
    ) -> Result<()> {
        helpers::buy_ticket(&ctx.accounts)?;
        helpers::mint_one(&ctx.accounts)?;
        helpers::create_metadata_ticket(
            &ctx.accounts,
            name,
            symbol,
            uri,
            seller_fee_bps,
            is_mutable,
        )?;
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_metadata_program.to_account_info(),
            SetAndVerifySizedCollectionItem {
                metadata: ctx.accounts.metadata.to_account_info(),
                collection_authority: ctx.accounts.collection_authority.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.update_authority.to_account_info(),
                collection_mint: ctx.accounts.collection_mint.to_account_info(),
                collection_metadata: ctx.accounts.collection_metadata.to_account_info(),
                collection_master_edition: ctx.accounts.collection_master_edition.to_account_info(),
            },
        );
        set_and_verify_sized_collection_item(cpi_ctx, None)?;
        //helpers::create_master_edition(&ctx.accounts)?;
        Ok(())
    }
}

mod helpers {
    use anchor_spl::metadata::mpl_token_metadata::types::{UseMethod, Uses};

    use super::*;

    pub fn mint_one(ctx: &Ticket) -> Result<()> {
        let seeds: &[&[u8]] = &[
            b"treasury",
            ctx.treasury.collection_mint.as_ref(),
            &[ctx.treasury.bump]
        ];
        spl_if::mint_to(
            CpiContext::new_with_signer(
                ctx.token_program.to_account_info(),
                MintTo {
                    mint: ctx.mint.to_account_info(),
                    to: ctx.associated_token_account.to_account_info(),
                    authority: ctx.treasury.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )
    }
    pub fn mint_one_event(ctx: &Event) -> Result<()> {
        let binding = ctx.mint.key();
        let seeds: &[&[u8]] = &[
            b"treasury",
            binding.as_ref(),
            &[ctx.treasury.bump]
        ];
        spl_if::mint_to(
            CpiContext::new_with_signer(
                ctx.token_program.to_account_info(),
                MintTo {
                    mint: ctx.mint.to_account_info(),
                    to: ctx.associated_token_account.to_account_info(),
                    authority: ctx.treasury.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )
    }

    pub fn create_metadata_event(
        ctx: &Event,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
        is_mutable: bool,
    ) -> Result<()> {
        super::pda_checks(&ctx.metadata, &ctx.master_edition, &ctx.mint)?;
        let creators = vec![Creator {
            address: ctx.update_authority.key(),
            verified: false,
            share: 100,
        }];
        let args = CreateArgs::V1 {
            name,
            symbol,
            uri,
            seller_fee_basis_points,
            creators: Some(creators),
            primary_sale_happened: false,
            is_mutable,
            token_standard: TokenStandard::NonFungible,
            collection: None,
            uses: None,
            collection_details: Some(CollectionDetails::V1 { size: 0 }),
            rule_set: None,
            decimals: Some(0),
            print_supply: Some(PrintSupply::Zero),
        };
        let binding = ctx.mint.key();
        let seeds: &[&[u8]] = &[
            b"treasury",
            binding.as_ref(),
            &[ctx.treasury.bump]
        ];

        Ok(CreateCpiBuilder::new(&ctx.token_metadata_program)
            .metadata(&ctx.metadata)
            .master_edition(Some(&ctx.master_edition))
            .mint(&ctx.mint.to_account_info(), true)
            .authority(&ctx.treasury.to_account_info())
            .payer(&ctx.payer)
            .update_authority(&ctx.update_authority, true)
            .system_program(&ctx.system_program)
            .spl_token_program(Some(&ctx.token_program))
            .sysvar_instructions(&ctx.sysvar_instructions)
            .create_args(args)
            .invoke_signed(&[seeds])?)
    }
    pub fn create_metadata_ticket(
        ctx: &Ticket,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
        is_mutable: bool,
    ) -> Result<()> {
        super::pda_checks(&ctx.metadata, &ctx.master_edition, &ctx.mint)?;
        let creators = vec![Creator {
            address: ctx.update_authority.key(),
            verified: false,
            share: 100,
        }];
        let args = CreateArgs::V1 {
            name,
            symbol,
            uri,
            seller_fee_basis_points,
            creators: Some(creators),
            primary_sale_happened: false,
            is_mutable,
            token_standard: TokenStandard::NonFungible,
            collection: Some(Collection {
                key: ctx.collection_mint.key(),
                verified: false,
            }),
            uses: Some(Uses {
                use_method: UseMethod::Single,
                remaining: 1,
                total: 1,
            }),
            collection_details: None,
            rule_set: None,
            decimals: Some(0),
            print_supply:  Some(PrintSupply::Zero),
        };
        let seeds: &[&[u8]] = &[
            b"treasury",
            ctx.treasury.collection_mint.as_ref(),
            &[ctx.treasury.bump],
        ];
        Ok(CreateCpiBuilder::new(&ctx.token_metadata_program)
            .metadata(&ctx.metadata)
            .master_edition(Some(&ctx.master_edition))
            .mint(&ctx.mint.to_account_info(), true)
            .authority(&ctx.treasury.to_account_info())
            .payer(&ctx.payer)
            .update_authority(&ctx.update_authority, true)
            .system_program(&ctx.system_program)
            .spl_token_program(Some(&ctx.token_program))
            .sysvar_instructions(&ctx.sysvar_instructions)
            .create_args(args)
            .invoke_signed(&[seeds])?)
    }
    pub fn buy_ticket(ctx: &Ticket) -> Result<()> {
        let price = ctx.treasury.price;
        let cpi_program = ctx.system_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.payer.to_account_info(),
            to: ctx.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        system_program::transfer(cpi_ctx, price)
    }

    // pub fn create_master_edition(a: &Ticket) -> Result<()> {
    //     super::pda_checks(&a.metadata, &a.master_edition, &a.mint)?;
    //     Ok(CreateMasterEditionV3CpiBuilder::new(&a.token_metadata_program)
    //         .edition(&a.master_edition)
    //         .mint(&a.mint.to_account_info())
    //         .update_authority(&a.update_authority)
    //         .mint_authority(&a.mint_authority)
    //         .payer(&a.payer)
    //         .metadata(&a.metadata)
    //         .system_program(&a.system_program)
    //         .token_program(&a.token_program)
    //         .max_supply(0)
    //         .invoke()?)
    // }
    // pub fn create_master_edition_event(a: &Event) -> Result<()> {
    //     super::pda_checks(&a.metadata, &a.master_edition, &a.mint)?;
    //     Ok(CreateMasterEditionV3CpiBuilder::new(&a.token_metadata_program)
    //         .edition(&a.master_edition)
    //         .mint(&a.mint.to_account_info())
    //         .update_authority(&a.update_authority)
    //         .mint_authority(&a.mint_authority)
    //         .payer(&a.payer)
    //         .metadata(&a.metadata)
    //         .system_program(&a.system_program)
    //         .token_program(&a.token_program)
    //         .max_supply(0)
    //         .invoke()?)
    // }
}

fn pda_checks(
    metadata: &UncheckedAccount,
    master_edition: &UncheckedAccount,
    mint: &Account<Mint>,
) -> Result<()> {
    let (md, _) = Pubkey::find_program_address(
        &[
            b"metadata",
            &TOKEN_METADATA_ID.to_bytes(),
            &mint.key().to_bytes(),
        ],
        &TOKEN_METADATA_ID,
    );
    require_keys_eq!(md, metadata.key(), NftError::BadMetadataPda);

    let (ed, _) = Pubkey::find_program_address(
        &[
            b"metadata",
            &TOKEN_METADATA_ID.to_bytes(),
            &mint.key().to_bytes(),
            b"edition",
        ],
        &TOKEN_METADATA_ID,
    );
    require_keys_eq!(ed, master_edition.key(), NftError::BadEditionPda);
    Ok(())
}
#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub authority: Pubkey,
    pub collection_mint: Pubkey,
    pub event_ts: u64,
    pub bump: u8,
    pub price: u64,
}


#[derive(Accounts)]
pub struct Event<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub update_authority: Signer<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = treasury,
        mint::freeze_authority = treasury,
        // with classic SPL Token types, this must be Program<Token>
        mint::token_program = token_program,
    )]
    pub mint: Account<'info, Mint>,

    #[account(init,
    payer = payer,
    seeds = [b"treasury", mint.key().as_ref()],
    bump,
    space = 8 + Treasury::INIT_SPACE,
    )]
    pub treasury: Account<'info, Treasury>,

    pub owner: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub associated_token_account: Account<'info, TokenAccount>,

    /// CHECK:
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>, // <— classic SPL Token program
    /// CHECK:
    #[account(address = TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK:
    #[account(address = sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Ticket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub update_authority: Signer<'info>,
    #[account(
    mut,
    seeds = [b"treasury", treasury.collection_mint.key().as_ref()],
    bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = treasury,
        mint::freeze_authority = treasury,
        mint::token_program = token_program,
    )]
    pub mint: Account<'info, Mint>,

    pub owner: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub associated_token_account: Account<'info, TokenAccount>,

    // collection data
    /// CHECK:
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK:
    pub collection_master_edition: UncheckedAccount<'info>,
    pub collection_authority: Signer<'info>,

    // ticket metadata
    /// CHECK:
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    // programs
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>, // <—
    /// CHECK:
    #[account(address = TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK:
    #[account(address = sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[error_code]
pub enum NftError {
    #[msg("Bad metadata PDA")]
    BadMetadataPda,
    #[msg("Bad master edition PDA")]
    BadEditionPda,
}
